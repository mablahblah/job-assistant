import { describe, expect, test } from "vitest";
import { normalizeJob, normalizeJobs } from "./normalization";
import type { JobListEntry } from "../job-list-entry";
import type { TitleVocabularies } from "../title";
import type { TraceEvent, TraceWriter } from "../trace-writer";

// Covers normalizeJobs, the step wrapper that calls normalizeJob once per
// entry in a job list, writes its own trace rows, and folds the warnings
// normalization raises. What normalizeJob itself produces for a given raw
// field is covered in normalizer-events.test.ts and normalizer.test.ts and
// is not re-derived here beyond what proves normalizeJobs wires it through
// correctly.

// The measured defaults from scripts/db-seed.ts's SETTING_DEFAULTS, restated
// so title routing runs against what really ships. It moves whenever
// SETTING_DEFAULTS does, as do the copies in lib/normalizer.test.ts,
// lib/normalizer-events.test.ts and lib/title.test.ts.
const VOCABULARIES: TitleVocabularies = {
  headNouns: [
    "analyst", "architect", "artist", "consultant", "coordinator", "copywriter",
    "designer", "developer", "director", "engineer", "head", "lead", "manager",
    "owner", "producer", "programmer", "researcher", "scientist", "specialist",
    "strategist", "technician", "technologist", "translator", "vp", "writer",
  ],
  levels: [
    { store: "Intern", match: ["intern"] },
    { store: "Entry-Level", match: ["entry level", "entry-level"] },
    { store: "Jr.", match: ["junior", "jr", "jr."] },
    { store: "Associate", match: ["associate", "assoc"] },
    { store: "Mid-Level", match: ["mid level", "mid-level", "mid"] },
    { store: "Sr.", match: ["senior", "sr", "sr."] },
    { store: "Staff", match: ["staff"] },
    { store: "Lead", match: ["lead"] },
    { store: "Principal", match: ["principal"] },
    { store: "Head", match: ["head"] },
    { store: "Director", match: ["director"] },
    { store: "VP", match: ["vp"] },
    { store: "Chief", match: ["chief"] },
  ],
  suffixes: ["-er", "-or", "-ist", "-yst", "-ian", "-ant", "-ect"],
  removalWords: ["w2", "c2h", "evergreen"],
};

// One of the two step names normalizeJobs runs under in the real pipeline.
// Which of the two is used does not matter to these tests, only that it
// round-trips onto the trace row unchanged.
const STEP = "post_collection_normalization";

// A job with an id and collector already filled in, so a test only spells
// out the raw field it cares about rather than repeating id and collector on
// every line.
function baseJob(overrides: Partial<JobListEntry> = {}): JobListEntry {
  return { id: "job-1", collector: "lever", ...overrides };
}

// A local fake TraceWriter that records every event handed to it instead of
// writing to a database, so a test can assert on exactly what normalizeJobs
// wrote without spinning up Prisma.
function createFakeTraceWriter(): TraceWriter & { events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  return {
    events,
    async write(event) {
      events.push(event);
    },
    failureCount() {
      return 0;
    },
  };
}

describe("normalizeJobs: the jobs it returns", () => {
  test("returns a list the same length as the one handed in", async () => {
    const jobs = [baseJob({ id: "1" }), baseJob({ id: "2" }), baseJob({ id: "3" })];
    const result = await normalizeJobs(jobs, { vocabularies: VOCABULARIES });
    expect(result.jobs).toHaveLength(3);
  });

  test("keeps jobs in the order they were handed in", async () => {
    const jobs = [baseJob({ id: "1" }), baseJob({ id: "2" }), baseJob({ id: "3" })];
    const result = await normalizeJobs(jobs, { vocabularies: VOCABULARIES });
    expect(result.jobs.map((job) => job.id)).toEqual(["1", "2", "3"]);
  });

  test("normalizes each entry exactly as normalizeJob would on its own", async () => {
    // Senior UX Designer becomes Sr. UX Designer under normalizeJob, so
    // seeing the same job back proves normalizeJobs routes through it
    // rather than through some parallel copy of the same logic.
    const job = baseJob({ raw_title: "Senior UX Designer" });
    const result = await normalizeJobs([job], { vocabularies: VOCABULARIES });
    expect(result.jobs[0]).toEqual(normalizeJob(job, VOCABULARIES).job);
  });
});

describe("normalizeJobs: an empty job list", () => {
  test("returns an empty job list", async () => {
    const result = await normalizeJobs([], { vocabularies: VOCABULARIES });
    expect(result.jobs).toEqual([]);
  });

  test("returns no warnings", async () => {
    const result = await normalizeJobs([], { vocabularies: VOCABULARIES });
    expect(result.warnings).toEqual([]);
  });

  test("writes no trace", async () => {
    const trace = createFakeTraceWriter();
    await normalizeJobs([], { vocabularies: VOCABULARIES, trace, runId: "run-1", step: STEP });
    expect(trace.events).toEqual([]);
  });
});

describe("normalizeJobs: the trace rows it writes", () => {
  // A job carrying both a raw title and a raw salary, so normalizeJob
  // produces more than one event and "one row per event" is a real check
  // rather than a coincidence of a single-event job.
  const job = baseJob({
    raw_title: "Senior UX Designer",
    raw_salary: { salary_min: 85000, salary_max: 115000 },
  });

  test("writes one trace row per normalization event normalizeJob produced", async () => {
    const trace = createFakeTraceWriter();
    await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, runId: "run-1", step: STEP });
    const expectedEvents = normalizeJob(job, VOCABULARIES).events;
    expect(trace.events).toHaveLength(expectedEvents.length);
  });

  test("a trace row's job_id is the job's own id", async () => {
    const trace = createFakeTraceWriter();
    await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, runId: "run-1", step: STEP });
    expect(trace.events.every((event) => event.job_id === job.id)).toBe(true);
  });

  test("a trace row's collector is the job's own collector", async () => {
    const trace = createFakeTraceWriter();
    await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, runId: "run-1", step: STEP });
    expect(trace.events.every((event) => event.collector === job.collector)).toBe(true);
  });

  test("a trace row's run_id is options.runId", async () => {
    const trace = createFakeTraceWriter();
    await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, runId: "run-42", step: STEP });
    expect(trace.events.every((event) => event.run_id === "run-42")).toBe(true);
  });

  test("a trace row's step is options.step", async () => {
    const trace = createFakeTraceWriter();
    await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, runId: "run-1", step: STEP });
    expect(trace.events.every((event) => event.step === STEP)).toBe(true);
  });

  test("a trace row's event, reason and detail match the normalization event it came from", async () => {
    const trace = createFakeTraceWriter();
    await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, runId: "run-1", step: STEP });
    const expectedEvents = normalizeJob(job, VOCABULARIES).events;
    for (const expectedEvent of expectedEvents) {
      const row = trace.events.find((event) => event.reason === expectedEvent.reason);
      expect(row?.event).toBe(expectedEvent.event);
      expect(row?.detail).toEqual(expectedEvent.detail);
    }
  });
});

describe("normalizeJobs: handed no trace writer", () => {
  // No min or max in this envelope, only a period, so normalizeSalary comes
  // back empty and salary_unusable fires — one of the two reasons that warn.
  const job = baseJob({
    raw_title: "Senior UX Designer",
    raw_salary: { salary_period: "week" },
  });

  test("still normalizes the jobs", async () => {
    const result = await normalizeJobs([job], { vocabularies: VOCABULARIES, runId: "run-1", step: STEP });
    expect(result.jobs[0].title).toBe("Sr. UX Designer");
  });

  test("still returns the warnings normalization raised", async () => {
    const result = await normalizeJobs([job], { vocabularies: VOCABULARIES, runId: "run-1", step: STEP });
    expect(result.warnings).toHaveLength(1);
  });
});

describe("normalizeJobs: handed no run id", () => {
  const job = baseJob({
    raw_title: "Senior UX Designer",
    raw_salary: { salary_period: "week" },
  });

  test("writes no trace rows even though a trace writer and a step are present", async () => {
    const trace = createFakeTraceWriter();
    await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, step: STEP });
    expect(trace.events).toEqual([]);
  });

  test("still normalizes the jobs", async () => {
    const trace = createFakeTraceWriter();
    const result = await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, step: STEP });
    expect(result.jobs[0].title).toBe("Sr. UX Designer");
  });

  test("still returns the warnings normalization raised", async () => {
    const trace = createFakeTraceWriter();
    const result = await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, step: STEP });
    expect(result.warnings).toHaveLength(1);
  });
});

describe("normalizeJobs: handed no step", () => {
  const job = baseJob({
    raw_title: "Senior UX Designer",
    raw_salary: { salary_period: "week" },
  });

  test("writes no trace rows even though a trace writer and a run id are present", async () => {
    const trace = createFakeTraceWriter();
    await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, runId: "run-1" });
    expect(trace.events).toEqual([]);
  });

  test("still normalizes the jobs", async () => {
    const trace = createFakeTraceWriter();
    const result = await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, runId: "run-1" });
    expect(result.jobs[0].title).toBe("Sr. UX Designer");
  });

  test("still returns the warnings normalization raised", async () => {
    const trace = createFakeTraceWriter();
    const result = await normalizeJobs([job], { vocabularies: VOCABULARIES, trace, runId: "run-1" });
    expect(result.warnings).toHaveLength(1);
  });
});

describe("normalizeJobs: a job missing the fields a trace row and a warning are keyed by", () => {
  const jobMissingId: JobListEntry = {
    collector: "lever",
    raw_title: "Senior UX Designer",
    raw_salary: { salary_period: "week" },
  };
  const jobMissingCollector: JobListEntry = {
    id: "job-1",
    raw_title: "Senior UX Designer",
    raw_salary: { salary_period: "week" },
  };

  test("a job with no id is still normalized and still appears in the returned list", async () => {
    const result = await normalizeJobs([jobMissingId], { vocabularies: VOCABULARIES });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("Sr. UX Designer");
  });

  test("a job with no id produces no trace row", async () => {
    const trace = createFakeTraceWriter();
    await normalizeJobs([jobMissingId], { vocabularies: VOCABULARIES, trace, runId: "run-1", step: STEP });
    expect(trace.events).toEqual([]);
  });

  test("a job with no id contributes nothing to the warnings", async () => {
    const result = await normalizeJobs([jobMissingId], { vocabularies: VOCABULARIES });
    expect(result.warnings).toEqual([]);
  });

  test("a job with no collector is still normalized and still appears in the returned list", async () => {
    const result = await normalizeJobs([jobMissingCollector], { vocabularies: VOCABULARIES });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("Sr. UX Designer");
  });

  test("a job with no collector produces no trace row", async () => {
    const trace = createFakeTraceWriter();
    await normalizeJobs([jobMissingCollector], {
      vocabularies: VOCABULARIES,
      trace,
      runId: "run-1",
      step: STEP,
    });
    expect(trace.events).toEqual([]);
  });

  test("a job with no collector contributes nothing to the warnings", async () => {
    const result = await normalizeJobs([jobMissingCollector], { vocabularies: VOCABULARIES });
    expect(result.warnings).toEqual([]);
  });
});

describe("normalizeJobs: the reasons that never warn", () => {
  // One known-good input per reason, lifted from lib/normalizer-events.test.ts,
  // covering every reason except the two that do warn.
  const SILENT_REASON_CASES: Array<[reason: string, rawFields: Partial<JobListEntry>]> = [
    ["title_normalized", { raw_title: "Senior UX Designer" }],
    ["title_not_normalized", { raw_title: "UI/UX" }],
    ["salary_normalized", { raw_salary: { salary_min: 85000, salary_max: 115000 } }],
    [
      "salary_partially_normalized",
      { raw_salary: { salary_min: 85000, salary_period: "fortnight" } },
    ],
    ["work_mode_normalized", { raw_mode_list: ["Remote"] }],
    ["work_mode_partially_normalized", { raw_mode_list: ["Remote", "flexible"] }],
    ["company_name_normalized", { raw_company_name: "Meta Platforms, Inc. " }],
  ];

  test.each(SILENT_REASON_CASES)("%s raises no warning", async (_reason, rawFields) => {
    const result = await normalizeJobs([baseJob(rawFields)], { vocabularies: VOCABULARIES });
    expect(result.warnings).toEqual([]);
  });
});

describe("normalizeJobs: the reasons that do warn", () => {
  test("a salary that could not be read warns", async () => {
    const job = baseJob({ raw_salary: { salary_period: "week" } });
    const result = await normalizeJobs([job], { vocabularies: VOCABULARIES });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("salary_unusable");
  });

  test("a work mode list that could not be read warns", async () => {
    const job = baseJob({ raw_mode_list: ["flexible"] });
    const result = await normalizeJobs([job], { vocabularies: VOCABULARIES });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("work_mode_unusable");
  });

  test("two collectors each reporting an unusable salary get one warning line each", async () => {
    const jobs = [
      baseJob({ id: "1", collector: "lever", raw_salary: { salary_period: "week" } }),
      baseJob({ id: "2", collector: "greenhouse", raw_salary: { salary_period: "week" } }),
    ];
    const result = await normalizeJobs(jobs, { vocabularies: VOCABULARIES });
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.map((warning) => warning.collector).sort()).toEqual([
      "greenhouse",
      "lever",
    ]);
  });

  test("a folded warning line names how many jobs it covers", async () => {
    const jobs = [
      baseJob({ id: "1", raw_salary: { salary_period: "week" } }),
      baseJob({ id: "2", raw_salary: { salary_period: "day" } }),
      baseJob({ id: "3", raw_salary: { salary_period: "hour" } }),
    ];
    const result = await normalizeJobs(jobs, { vocabularies: VOCABULARIES });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("3 jobs");
  });

  test("a folded warning line carries at most two examples", async () => {
    // Three jobs from the same collector with the same unusable reason but
    // distinguishable raw values, so which two survive the fold can be seen
    // directly rather than inferred from a count.
    const jobs = [
      baseJob({ id: "1", raw_salary: { salary_period: "week" } }),
      baseJob({ id: "2", raw_salary: { salary_period: "day" } }),
      baseJob({ id: "3", raw_salary: { salary_period: "hour" } }),
    ];
    const result = await normalizeJobs(jobs, { vocabularies: VOCABULARIES });
    expect(result.warnings[0].message).toContain("week");
    expect(result.warnings[0].message).toContain("day");
    expect(result.warnings[0].message).not.toContain("hour");
  });
});

describe("normalizeJobs: the shape of the result", () => {
  test("carries only jobs and warnings", async () => {
    const result = await normalizeJobs([baseJob()], { vocabularies: VOCABULARIES });
    expect(Object.keys(result).sort()).toEqual(["jobs", "warnings"]);
  });

  test("returns no trace events for its caller to write", async () => {
    const result = await normalizeJobs([baseJob()], { vocabularies: VOCABULARIES });
    expect(result).not.toHaveProperty("events");
    expect(result).not.toHaveProperty("traceEvents");
  });
});
