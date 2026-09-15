import { describe, expect, test } from "vitest";
import { cleanBacklogCompanies, cleanBacklogJobs } from "./backlog-cleanup";
import type { JobListEntry } from "../types/job-list-entry";
import type { TraceEvent, TraceService } from "../services/trace-service";
import type { CompanyRecord } from "../services/company-service";
import { unscoredCompany } from "../services/company-service.fake";

// Covers only the trace rows the step writes. What it does to a job keeps its
// own coverage in backlog-cleanup.test.ts and is not re-asserted here.

const RUN_ID = "run-1";
const STEP = "backlog_cleanup";
const NOW = new Date("2026-09-14T12:00:00.000Z");
const THRESHOLD = 30;

const STALE = new Date("2026-07-01T12:00:00.000Z");
const FRESH = new Date("2026-09-10T12:00:00.000Z");

function entry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return {
    id,
    collector: "greenhouse",
    status: "backlog",
    collected_at: NOW,
    ...overrides,
  };
}

// Records every event handed to it instead of writing to a database, so a
// test asserts on exactly what the step wrote without spinning up Prisma.
function createFakeTraceService(): TraceService & { events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  return {
    events,
    async write(event) {
      events.push(event);
    },
    // No test here reads a summary back, so the fake answers with nothing
    // rather than keeping counts the tests would not check.
    async countsForRun() {
      return [];
    },
    failureCount() {
      return 0;
    },
  };
}

async function rowsFor(jobs: JobListEntry[]): Promise<TraceEvent[]> {
  const trace = createFakeTraceService();
  await cleanBacklogJobs(jobs, {
    expiryThresholdDays: THRESHOLD,
    referenceInstant: NOW,
    trace,
    runId: RUN_ID,
    step: STEP,
  });
  return trace.events;
}

// AC 80 and 81. A job takes a row entering the step and exactly one row
// leaving it, so a summary heading can say what the step was handed even
// where the step later died.
describe("the rows one job produces", () => {
  test("an expired job enters and then leaves as expired", async () => {
    const rows = await rowsFor([entry("stale", { posting_date: STALE })]);

    expect(rows).toEqual([
      {
        run_id: RUN_ID,
        job_id: "stale",
        step: STEP,
        event: "job_entered",
        collector: "greenhouse",
        reason: undefined,
      },
      {
        run_id: RUN_ID,
        job_id: "stale",
        step: STEP,
        event: "job_expired",
        collector: "greenhouse",
        reason: "past_expiry_threshold",
      },
    ]);
  });

  test("a kept job enters and then leaves as kept", async () => {
    const rows = await rowsFor([entry("fresh", { posting_date: FRESH })]);

    expect(rows.map((row) => row.event)).toEqual(["job_entered", "job_kept"]);
  });

  // The success row carries no reason, because one population needs nothing
  // to group by.
  test("the kept row names no reason", async () => {
    const rows = await rowsFor([entry("fresh", { posting_date: FRESH })]);

    expect(rows[1].reason).toBeUndefined();
  });
});

// AC 96. Every job's pair of rows is written before the next job's, so a
// count per outcome reads off this step alone and never borrows a row from
// the job beside it.
describe("the rows a list produces", () => {
  test("each job writes its own entering and outcome row", async () => {
    const rows = await rowsFor([
      entry("stale", { posting_date: STALE }),
      entry("fresh", { posting_date: FRESH }),
    ]);

    expect(rows.map((row) => [row.job_id, row.event])).toEqual([
      ["stale", "job_entered"],
      ["stale", "job_expired"],
      ["fresh", "job_entered"],
      ["fresh", "job_kept"],
    ]);
  });

  // AC 85. A step handed nothing still runs, and writes nothing.
  test("a step handed no jobs writes no rows", async () => {
    expect(await rowsFor([])).toEqual([]);
  });

  // A row is keyed by job id and collector, so a job carrying neither has
  // nothing to key its record on.
  test("a job missing its collector writes no rows", async () => {
    const rows = await rowsFor([{ id: "no-collector", collected_at: NOW, posting_date: STALE }]);

    expect(rows).toEqual([]);
  });
});

// The step runs outside a job search as well as inside one, so it needs all
// three of the trace service, the run id and the step name before it writes.
describe("a step handed no run to write against", () => {
  test("it still expires the job it was handed", async () => {
    const result = await cleanBacklogJobs([entry("stale", { posting_date: STALE })], {
      expiryThresholdDays: THRESHOLD,
      referenceInstant: NOW,
    });

    expect(result.jobs[0].status).toBe("expired");
  });

  test("it writes nothing when it has the service but no run id", async () => {
    const trace = createFakeTraceService();

    await cleanBacklogJobs([entry("stale", { posting_date: STALE })], {
      expiryThresholdDays: THRESHOLD,
      referenceInstant: NOW,
      trace,
      step: STEP,
    });

    expect(trace.events).toEqual([]);
  });
});

// The company half of the same sweep. A company event names the company and
// carries no job and no collector, because a company score has neither behind
// it.
describe("the rows the company sweep writes", () => {
  const SCORE_EXPIRY_DAYS = 90;
  const GUESSED_SCORE_EXPIRY_DAYS = 30;

  function daysBefore(days: number): Date {
    return new Date(NOW.getTime() - days * 86_400_000);
  }

  function company(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
    return unscoredCompany({
      id: "company-1",
      name: "Traced Co",
      employee_satisfaction: 4,
      customer_satisfaction: 3,
      work_life_balance: 5,
      political_alignment: 2,
      scored_at: daysBefore(1),
      ...overrides,
    });
  }

  async function sweep(record: CompanyRecord): Promise<TraceEvent[]> {
    const trace = createFakeTraceService();
    await cleanBacklogCompanies([record], {
      scoreExpiryDays: SCORE_EXPIRY_DAYS,
      guessedScoreExpiryDays: GUESSED_SCORE_EXPIRY_DAYS,
      referenceInstant: NOW,
      trace,
      runId: RUN_ID,
      step: STEP,
    });
    return trace.events;
  }

  // Criterion 69. An entering row per company, so a heading can say what the
  // handler was handed even where the handler later died.
  test("a company entering the sweep gets a row", async () => {
    const events = await sweep(company());

    expect(events[0]?.event).toBe("company_entered");
  });

  // Criterion 70.
  test("the row names the company", async () => {
    const events = await sweep(company());

    expect(events[0]?.company_id).toBe("company-1");
  });

  // Criteria 70a and 100.
  test("the row carries no job and no collector", async () => {
    const events = await sweep(company());

    expect(events[0]?.job_id).toBeUndefined();
    expect(events[0]?.collector).toBeUndefined();
  });

  test("every row carries the run identifier and the step", async () => {
    const events = await sweep(company());

    for (const event of events) {
      expect(event.run_id).toBe(RUN_ID);
      expect(event.step).toBe(STEP);
    }
  });

  test("a company left alone records that it was kept", async () => {
    const events = await sweep(company());

    expect(events.map((event) => event.event)).toEqual(["company_entered", "company_kept"]);
  });

  test("a company past the score expiry records why its scores went", async () => {
    const events = await sweep(company({ scored_at: daysBefore(91) }));

    expect(events[1]?.event).toBe("company_scores_cleared");
    expect(events[1]?.reason).toBe("past_score_expiry");
  });

  // The two clearings are told apart by their reason, so one query can count
  // how often a guess is what aged out.
  test("a company past only the guessed-score expiry records its own reason", async () => {
    const events = await sweep(
      company({ scored_at: daysBefore(31), scores_guessed: ["customer_satisfaction"] })
    );

    expect(events[1]?.event).toBe("company_scores_cleared");
    expect(events[1]?.reason).toBe("past_guessed_score_expiry");
  });

  // A handler handed only some of trace, runId and step still does its work
  // and stays silent, which is what lets it run outside a job search.
  test("a sweep handed no run identifier writes nothing", async () => {
    const trace = createFakeTraceService();
    await cleanBacklogCompanies([company()], {
      scoreExpiryDays: SCORE_EXPIRY_DAYS,
      guessedScoreExpiryDays: GUESSED_SCORE_EXPIRY_DAYS,
      referenceInstant: NOW,
      trace,
      step: STEP,
    });

    expect(trace.events).toEqual([]);
  });
});
