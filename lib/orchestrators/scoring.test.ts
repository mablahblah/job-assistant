import { describe, expect, test } from "vitest";
import { runScoringGather, runScoringSave } from "./scoring";
import { fakeCompanyService, unscoredCompany } from "../services/company-service.fake";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import type { AtsSlugRecord } from "../services/ats-slug-service";
import { fakeJobService } from "../services/job-service.fake";
import { fakeSettingsService } from "../services/settings-service.fake";
import { SCORE_CATEGORIES, type CompanyRecord } from "../services/company-service";
import type { JobListEntry } from "../types/job-list-entry";
import type { TraceEvent, TraceService } from "../services/trace-service";

// Every age in one run is measured against the instant the run started, so a
// fixed date here stands in for that moment.
const NOW = new Date("2026-09-15T00:00:00.000Z");
const RUN_ID = "test-run-id";

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

// A stand-in trace service that keeps every row it was handed, so a test can
// read them back rather than assert against a mock.
interface FakeTraceService extends TraceService {
  events: TraceEvent[];
}

function makeTraceService(failures = 0): FakeTraceService {
  const events: TraceEvent[] = [];
  return {
    events,
    async write(event) {
      events.push(event);
    },
    async countsForRun() {
      return [];
    },
    failureCount() {
      return failures;
    },
  };
}

// A job that has been all the way through the pipeline and still carries no
// alignment score, which is exactly what the scoring search looks for.
function scoreableJob(overrides: Partial<JobListEntry> = {}): JobListEntry {
  return {
    id: "j1",
    collector: "lever",
    original_url: "https://example.com/j1",
    title: "Product Designer",
    status: "backlog",
    is_resolved: true,
    is_parsed: true,
    is_classified: true,
    alignment_score: null,
    collected_at: daysBefore(1),
    posting_date: daysBefore(1),
    ...overrides,
  };
}

// A company an agent has already scored on all four categories.
function scoredCompany(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return unscoredCompany({
    id: "c1",
    name: "Scored Co",
    match_key: "scoredco",
    employee_satisfaction: 4,
    customer_satisfaction: 3,
    work_life_balance: 5,
    political_alignment: 2,
    employee_satisfaction_rationale: "well reviewed",
    customer_satisfaction_rationale: "nothing public",
    work_life_balance_rationale: "respects time",
    political_alignment_rationale: "mixed record",
    scored_at: daysBefore(1),
    ...overrides,
  });
}

// The real company search joins to the job table, which a fake holding no
// jobs cannot do. This stands in for it: any company missing a category score
// is one to research.
function companiesNeedingScores(companies: CompanyRecord[]): () => Promise<CompanyRecord[]> {
  return async () =>
    companies.filter((company) =>
      SCORE_CATEGORIES.some((category) => company[category] === null)
    );
}

// Criterion 1. Scoring asks the database for the jobs to score rather than
// reading a list handed to it.
describe("the jobs to score", () => {
  test("the list comes back from the job service's own search", async () => {
    const result = await runScoringGather({
      settings: fakeSettingsService(),
      companies: fakeCompanyService([]),
      jobService: fakeJobService([scoreableJob()]),
      trace: makeTraceService(),
      runId: RUN_ID,
      referenceInstant: NOW,
    });

    expect(result.jobs.map((job) => job.id)).toEqual(["j1"]);
  });
});

// Criterion 2. The companies are a second search of its own.
describe("the companies to score", () => {
  test("the list comes back from the company service's own search", async () => {
    const needing = unscoredCompany({ id: "c2", name: "Unscored Co" });
    const result = await runScoringGather({
      settings: fakeSettingsService(),
      companies: fakeCompanyService([needing], {
        findNeedingScores: companiesNeedingScores([needing]),
      }),
      jobService: fakeJobService([]),
      trace: makeTraceService(),
      runId: RUN_ID,
      referenceInstant: NOW,
    });

    expect(result.companies.map((company) => company.id)).toEqual(["c2"]);
  });
});

// Criteria 39, 41a and 110. Backlog cleanup opens the run, and its writes land
// before either search reads, so a company this run just emptied is researched
// by this run rather than the next one.
describe("backlog cleanup runs before anything is gathered", () => {
  test("a company whose stale scores this run cleared is on the list of companies", async () => {
    const stale = [scoredCompany({ scored_at: daysBefore(91) })];
    const result = await runScoringGather({
      settings: fakeSettingsService(),
      companies: fakeCompanyService(stale, {
        findNeedingScores: companiesNeedingScores(stale),
      }),
      jobService: fakeJobService([]),
      trace: makeTraceService(),
      runId: RUN_ID,
      referenceInstant: NOW,
    });

    expect(result.companies.map((company) => company.id)).toEqual(["c1"]);
    expect(result.companyScoresCleared).toBe(1);
  });

  test("a job this run expired is not on the list of jobs", async () => {
    // The fake settings service expires a job at eight days.
    const result = await runScoringGather({
      settings: fakeSettingsService(),
      companies: fakeCompanyService([]),
      jobService: fakeJobService([
        scoreableJob({ collected_at: daysBefore(60), posting_date: daysBefore(60) }),
      ]),
      trace: makeTraceService(),
      runId: RUN_ID,
      referenceInstant: NOW,
    });

    expect(result.jobs).toEqual([]);
  });
});

// Criteria 68, 69 and 72. An entering row per job and per company, carrying
// the run identifier the pipeline's own rows carry.
describe("what gathering records", () => {
  test("each job handed to alignment scoring leaves an entering row", async () => {
    const trace = makeTraceService();
    await runScoringGather({
      settings: fakeSettingsService(),
      companies: fakeCompanyService([]),
      jobService: fakeJobService([scoreableJob()]),
      trace,
      runId: RUN_ID,
      referenceInstant: NOW,
    });

    const entered = trace.events.filter(
      (event) => event.step === "scoring" && event.event === "job_entered"
    );
    expect(entered).toEqual([
      { run_id: RUN_ID, job_id: "j1", step: "scoring", event: "job_entered", collector: "lever" },
    ]);
  });

  test("each company handed to company scoring leaves an entering row", async () => {
    const trace = makeTraceService();
    const needing = unscoredCompany({ id: "c2", name: "Unscored Co" });
    await runScoringGather({
      settings: fakeSettingsService(),
      companies: fakeCompanyService([needing], {
        findNeedingScores: companiesNeedingScores([needing]),
      }),
      jobService: fakeJobService([]),
      trace,
      runId: RUN_ID,
      referenceInstant: NOW,
    });

    const entered = trace.events.filter(
      (event) => event.step === "scoring" && event.event === "company_entered"
    );
    expect(entered).toEqual([
      { run_id: RUN_ID, company_id: "c2", step: "scoring", event: "company_entered" },
    ]);
  });
});

// A gather that falls over reports where and why rather than throwing, so the
// caller still sees whatever the run wrote before it stopped.
describe("a read that throws", () => {
  test("is reported as a failure naming the spot", async () => {
    const result = await runScoringGather({
      settings: fakeSettingsService({
        getScoreExpiryDays: async () => {
          throw new Error("score_expiry_days is not set");
        },
      }),
      companies: fakeCompanyService([]),
      jobService: fakeJobService([]),
      trace: makeTraceService(),
      runId: RUN_ID,
      referenceInstant: NOW,
    });

    expect(result.failure).toEqual({
      at: "score_expiry_days",
      reason: "score_expiry_days is not set",
    });
    expect(result.jobs).toEqual([]);
  });
});

// The second starting point. The agent has done its thinking by now, so this
// half only writes the answers down and records what became of each entry.
describe("saving a job's alignment score", () => {
  test("the score and its reasoning are written through the job service", async () => {
    const jobs = [scoreableJob()];
    const jobService = fakeJobService(jobs);

    await runScoringSave({
      jobScores: [{ id: "j1", alignment_score: 7, alignment_rationale: "close fit" }],
      companyScores: [],
      settings: fakeSettingsService(),
      companies: fakeCompanyService([]),
      jobService,
      atsSlugs: fakeAtsSlugService([]),
      trace: makeTraceService(),
      runId: RUN_ID,
      scoredAt: NOW,
    });

    const stored = jobs.find((job) => job.id === "j1");
    expect(stored?.alignment_score).toBe(7);
    expect(stored?.alignment_rationale).toBe("close fit");
  });

  test("a scored job leaves a scored row carrying no score of its own", async () => {
    const trace = makeTraceService();
    await runScoringSave({
      jobScores: [{ id: "j1", alignment_score: 7, alignment_rationale: "close fit" }],
      companyScores: [],
      settings: fakeSettingsService(),
      companies: fakeCompanyService([]),
      jobService: fakeJobService([scoreableJob()]),
      atsSlugs: fakeAtsSlugService([]),
      trace,
      runId: RUN_ID,
      scoredAt: NOW,
    });

    const scored = trace.events.filter(
      (event) => event.step === "scoring" && event.event === "job_scored"
    );
    expect(scored).toEqual([
      { run_id: RUN_ID, job_id: "j1", step: "scoring", event: "job_scored", collector: "lever" },
    ]);
  });

  test("a job whose helper named a reason is recorded under that reason", async () => {
    const trace = makeTraceService();
    await runScoringSave({
      jobScores: [{ id: "j1", failure: "no_posting_url" }],
      companyScores: [],
      settings: fakeSettingsService(),
      companies: fakeCompanyService([]),
      jobService: fakeJobService([scoreableJob()]),
      atsSlugs: fakeAtsSlugService([]),
      trace,
      runId: RUN_ID,
      scoredAt: NOW,
    });

    const failed = trace.events.filter((event) => event.event === "scoring_failed");
    expect(failed).toEqual([
      {
        run_id: RUN_ID,
        job_id: "j1",
        step: "scoring",
        event: "scoring_failed",
        reason: "no_posting_url",
        collector: "lever",
      },
    ]);
  });

  test("a job that came back with neither a score nor a reason blames the helper", async () => {
    const trace = makeTraceService();
    await runScoringSave({
      jobScores: [{ id: "j1" }],
      companyScores: [],
      settings: fakeSettingsService(),
      companies: fakeCompanyService([]),
      jobService: fakeJobService([scoreableJob()]),
      atsSlugs: fakeAtsSlugService([]),
      trace,
      runId: RUN_ID,
      scoredAt: NOW,
    });

    const failed = trace.events.filter((event) => event.event === "scoring_failed");
    expect(failed[0]?.reason).toBe("scoring_agent_failed");
  });
});

describe("saving a company's scores", () => {
  const fourScores = {
    employee_satisfaction: { score: 4, rationale: "well reviewed", guessed: false },
    customer_satisfaction: { score: 3, rationale: "mixed", guessed: false },
    work_life_balance: { score: 5, rationale: "respects time", guessed: false },
    political_alignment: { score: 2, rationale: "mixed record", guessed: false },
  };

  test("the four scores and the date are written through the company service", async () => {
    const stored = [unscoredCompany({ id: "c2", name: "Unscored Co" })];
    await runScoringSave({
      jobScores: [],
      companyScores: [{ id: "c2", scores: fourScores }],
      settings: fakeSettingsService(),
      companies: fakeCompanyService(stored),
      jobService: fakeJobService([]),
      atsSlugs: fakeAtsSlugService([]),
      trace: makeTraceService(),
      runId: RUN_ID,
      scoredAt: NOW,
    });

    expect(stored[0]?.employee_satisfaction).toBe(4);
    expect(stored[0]?.political_alignment).toBe(2);
    expect(stored[0]?.scored_at).toEqual(NOW);
  });

  test("a fully researched company leaves a scored row", async () => {
    const trace = makeTraceService();
    await runScoringSave({
      jobScores: [],
      companyScores: [{ id: "c2", scores: fourScores }],
      settings: fakeSettingsService(),
      companies: fakeCompanyService([unscoredCompany({ id: "c2", name: "Unscored Co" })]),
      jobService: fakeJobService([]),
      atsSlugs: fakeAtsSlugService([]),
      trace,
      runId: RUN_ID,
      scoredAt: NOW,
    });

    expect(trace.events.filter((event) => event.event === "company_scored")).toEqual([
      { run_id: RUN_ID, company_id: "c2", step: "scoring", event: "company_scored" },
    ]);
  });

  test("a company with a guessed category is recorded as partially scored", async () => {
    const trace = makeTraceService();
    await runScoringSave({
      jobScores: [],
      companyScores: [
        {
          id: "c2",
          scores: {
            ...fourScores,
            customer_satisfaction: { score: 3, rationale: "nothing public", guessed: true },
          },
        },
      ],
      settings: fakeSettingsService(),
      companies: fakeCompanyService([unscoredCompany({ id: "c2", name: "Unscored Co" })]),
      jobService: fakeJobService([]),
      atsSlugs: fakeAtsSlugService([]),
      trace,
      runId: RUN_ID,
      scoredAt: NOW,
    });

    expect(trace.events.filter((event) => event.event === "company_partially_scored")).toEqual([
      {
        run_id: RUN_ID,
        company_id: "c2",
        step: "scoring",
        event: "company_partially_scored",
        reason: "insufficient_research",
      },
    ]);
  });

  test("a company whose helper named a reason is recorded under that reason", async () => {
    const trace = makeTraceService();
    await runScoringSave({
      jobScores: [],
      companyScores: [{ id: "c2", failure: "no_company_name" }],
      settings: fakeSettingsService(),
      companies: fakeCompanyService([unscoredCompany({ id: "c2" })]),
      jobService: fakeJobService([]),
      atsSlugs: fakeAtsSlugService([]),
      trace,
      runId: RUN_ID,
      scoredAt: NOW,
    });

    expect(trace.events.filter((event) => event.event === "company_scoring_failed")).toEqual([
      {
        run_id: RUN_ID,
        company_id: "c2",
        step: "scoring",
        event: "company_scoring_failed",
        reason: "no_company_name",
      },
    ]);
  });
});

// Criterion 73. One helper falling over costs its own entry and nothing else.
describe("a company whose write throws", () => {
  test("is recorded as a failure and the next company is still written", async () => {
    const trace = makeTraceService();
    const stored = [unscoredCompany({ id: "c3", name: "Second Co" })];
    const companies = fakeCompanyService(stored);

    await runScoringSave({
      jobScores: [],
      companyScores: [
        { id: "missing", scores: { employee_satisfaction: { score: 4, rationale: "x", guessed: false } } },
        { id: "c3", scores: { employee_satisfaction: { score: 5, rationale: "y", guessed: false } } },
      ],
      settings: fakeSettingsService(),
      companies,
      jobService: fakeJobService([]),
      atsSlugs: fakeAtsSlugService([]),
      trace,
      runId: RUN_ID,
      scoredAt: NOW,
    });

    expect(stored[0]?.employee_satisfaction).toBe(5);
    const failed = trace.events.filter((event) => event.event === "company_scoring_failed");
    expect(failed.map((event) => event.company_id)).toEqual(["missing"]);
  });
});

// Criterion 52. Promotion closes the saving half: a company this batch just
// scored well is put on a polling list before the batch ends, rather than
// waiting for a separate pass.
describe("promotion after a company is scored", () => {
  // Four fours average to 4, which clears the fake settings service's
  // promotion threshold of 3.5.
  const highScores = {
    employee_satisfaction: { score: 4, rationale: "well reviewed", guessed: false },
    customer_satisfaction: { score: 4, rationale: "well reviewed", guessed: false },
    work_life_balance: { score: 4, rationale: "well reviewed", guessed: false },
    political_alignment: { score: 4, rationale: "well reviewed", guessed: false },
  };

  function boardRow(companyId: string): AtsSlugRecord {
    return { id: "s1", slug: "goodco", company_id: companyId, parser: "greenhouse", collector: null };
  }

  test("a company scoring above the threshold gets its board polled", async () => {
    const rows = [boardRow("c2")];
    await runScoringSave({
      jobScores: [],
      companyScores: [{ id: "c2", scores: highScores }],
      settings: fakeSettingsService(),
      companies: fakeCompanyService([unscoredCompany({ id: "c2", name: "Good Co" })]),
      jobService: fakeJobService([]),
      atsSlugs: fakeAtsSlugService(rows),
      trace: makeTraceService(),
      runId: RUN_ID,
      scoredAt: NOW,
    });

    expect(rows[0]?.collector).toBe("greenhouse");
  });

  test("a company whose write failed is not promoted", async () => {
    const rows = [boardRow("missing")];
    await runScoringSave({
      jobScores: [],
      companyScores: [{ id: "missing", scores: highScores }],
      settings: fakeSettingsService(),
      companies: fakeCompanyService([]),
      jobService: fakeJobService([]),
      atsSlugs: fakeAtsSlugService(rows),
      trace: makeTraceService(),
      runId: RUN_ID,
      scoredAt: NOW,
    });

    expect(rows[0]?.collector).toBeNull();
  });

  test("promotion records what it did under its own step", async () => {
    const trace = makeTraceService();
    await runScoringSave({
      jobScores: [],
      companyScores: [{ id: "c2", scores: highScores }],
      settings: fakeSettingsService(),
      companies: fakeCompanyService([unscoredCompany({ id: "c2", name: "Good Co" })]),
      jobService: fakeJobService([]),
      atsSlugs: fakeAtsSlugService([boardRow("c2")]),
      trace,
      runId: RUN_ID,
      scoredAt: NOW,
    });

    const promoted = trace.events.filter((event) => event.step === "company_promotion");
    expect(promoted.map((event) => event.event)).toEqual(["company_entered", "company_promoted"]);
  });
});

// Scoring is what judges a job. Once a batch is saved, each job it answered
// for is marked judged when it holds a fit score or its employer holds any
// score. The check runs after both halves, so an employer scored in the same
// batch counts.
describe("marking the jobs a batch answered for as judged", () => {
  const oneScore = {
    employee_satisfaction: { score: 4, rationale: "well reviewed", guessed: false },
  };

  async function saveBatch(
    jobs: JobListEntry[],
    companies: CompanyRecord[],
    batch: Pick<Parameters<typeof runScoringSave>[0], "jobScores" | "companyScores">,
    trace: FakeTraceService = makeTraceService()
  ) {
    return runScoringSave({
      ...batch,
      settings: fakeSettingsService(),
      companies: fakeCompanyService(companies),
      jobService: fakeJobService(jobs),
      atsSlugs: fakeAtsSlugService([]),
      trace,
      runId: RUN_ID,
      scoredAt: NOW,
    });
  }

  test("a job whose fit score is saved is judged", async () => {
    const jobs = [scoreableJob({ is_judged: false })];

    await saveBatch(jobs, [], {
      jobScores: [{ id: "j1", alignment_score: 7, alignment_rationale: "close fit" }],
      companyScores: [],
    });

    expect(jobs[0]?.is_judged).toBe(true);
  });

  test("a job whose fit score failed is judged when its employer already holds a score", async () => {
    const jobs = [scoreableJob({ company_id: "c1", is_judged: false })];

    await saveBatch(jobs, [scoredCompany()], {
      jobScores: [{ id: "j1", failure: "posting_unreadable" }],
      companyScores: [],
    });

    expect(jobs[0]?.is_judged).toBe(true);
  });

  test("a job whose fit score failed is judged when the same batch scores its employer", async () => {
    const jobs = [scoreableJob({ company_id: "c2", is_judged: false })];

    await saveBatch(jobs, [unscoredCompany({ id: "c2", name: "Unscored Co" })], {
      jobScores: [{ id: "j1", failure: "posting_unreadable" }],
      companyScores: [{ id: "c2", scores: oneScore }],
    });

    expect(jobs[0]?.is_judged).toBe(true);
  });

  test("a job whose fit score failed stays unjudged when its employer holds no score", async () => {
    const jobs = [scoreableJob({ company_id: "c2", is_judged: false })];

    await saveBatch(jobs, [unscoredCompany({ id: "c2", name: "Unscored Co" })], {
      jobScores: [{ id: "j1", failure: "scoring_agent_failed" }],
      companyScores: [],
    });

    expect(jobs[0]?.is_judged).toBe(false);
  });

  // A job whose page was refused never reaches scoring, so the batch holds no
  // answer for it, whatever it does for the employer.
  test("a job the batch holds no answer for stays unjudged when its employer is scored", async () => {
    const jobs = [
      scoreableJob({ company_id: "c2", is_judged: false }),
      scoreableJob({ id: "refused", company_id: "c2", is_resolved: false, is_judged: false }),
    ];

    await saveBatch(jobs, [unscoredCompany({ id: "c2", name: "Unscored Co" })], {
      jobScores: [{ id: "j1", alignment_score: 5 }],
      companyScores: [{ id: "c2", scores: oneScore }],
    });

    expect(jobs.find((job) => job.id === "refused")?.is_judged).toBe(false);
  });

  // A marker write that fails says nothing about the rest of the batch. The
  // jobs after it still need marking, and the company this batch scored well
  // still needs its board polled.
  test("a job whose marker write fails costs only that job", async () => {
    const jobs = [
      scoreableJob({ id: "j1", company_id: "c2", is_judged: false }),
      scoreableJob({ id: "j2", company_id: "c2", is_judged: false }),
    ];
    const held = fakeJobService(jobs);
    const jobService = {
      ...held,
      async update(entry: Partial<JobListEntry>, priorityList: readonly string[]) {
        if (entry.is_judged === true && entry.id === "j1") throw new Error("db write failed");
        return held.update(entry, priorityList);
      },
    };
    const boards = [
      { id: "s1", slug: "goodco", company_id: "c2", parser: "greenhouse", collector: null },
    ];

    const result = await runScoringSave({
      jobScores: [
        { id: "j1", failure: "posting_unreadable" },
        { id: "j2", failure: "posting_unreadable" },
      ],
      companyScores: [
        {
          id: "c2",
          scores: {
            employee_satisfaction: { score: 4, rationale: "well reviewed", guessed: false },
            customer_satisfaction: { score: 4, rationale: "well reviewed", guessed: false },
            work_life_balance: { score: 4, rationale: "well reviewed", guessed: false },
            political_alignment: { score: 4, rationale: "well reviewed", guessed: false },
          },
        },
      ],
      settings: fakeSettingsService(),
      companies: fakeCompanyService([unscoredCompany({ id: "c2", name: "Good Co" })]),
      jobService,
      atsSlugs: fakeAtsSlugService(boards),
      trace: makeTraceService(),
      runId: RUN_ID,
      scoredAt: NOW,
    });

    expect(jobs.find((job) => job.id === "j2")?.is_judged).toBe(true);
    expect(result.failure).toBeNull();
    expect(result.warnings.some((warning) => warning.message.includes("j1"))).toBe(true);
    expect(boards[0]?.collector).toBe("greenhouse");
  });

  test("nothing the batch records or warns about mentions the judged marker", async () => {
    const trace = makeTraceService();
    const jobs = [scoreableJob({ company_id: "c2", is_judged: false })];

    const result = await saveBatch(
      jobs,
      [unscoredCompany({ id: "c2", name: "Unscored Co" })],
      {
        jobScores: [{ id: "j1", failure: "posting_unreadable" }],
        companyScores: [{ id: "c2", scores: oneScore }],
      },
      trace
    );

    expect(jobs[0]?.is_judged).toBe(true);
    expect(JSON.stringify([trace.events, result.warnings])).not.toMatch(/judged/i);
  });
});

// Gathering saves the whole backlog after cleaning it, and a save writes each
// job's key afresh from its link. Without the settings' identifying query
// values, every gather would strip UltiPro's opportunityid back out of the
// stored keys, and two openings on one board would key the same again.
describe("the backlog save keeps identifying query values in the stored keys", () => {
  test("an UltiPro job's key keeps its opportunityid after a gather", async () => {
    const BOARD = "https://recruiting.ultipro.com/acm1000acme/jobboard/5b3c/opportunitydetail";
    const link = `${BOARD}?opportunityid=A1&utm_source=adzuna`;
    const jobs = [scoreableJob({ original_url: link, resolved_url: link })];

    await runScoringGather({
      settings: fakeSettingsService(),
      companies: fakeCompanyService([]),
      jobService: fakeJobService(jobs),
      trace: makeTraceService(),
      runId: RUN_ID,
      referenceInstant: NOW,
    });

    expect(jobs[0]?.original_url_match_key).toBe(`${BOARD}?opportunityid=A1`);
    expect(jobs[0]?.resolved_url_match_key).toBe(`${BOARD}?opportunityid=A1`);
  });
});
