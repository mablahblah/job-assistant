import { describe, expect, test } from "vitest";
import { collectJobs } from "./collection";
import type { Collector, CollectorContext, CollectorResult } from "../collectors/collector";
import type { JobListEntry } from "../types/job-list-entry";
import type { SettingsService } from "../services/settings-service";
import type { UnusableCode } from "../utils/job-usable";
import type { TraceEvent, TraceService } from "../services/trace-service";
import { fakeSettingsService } from "../services/settings-service.fake";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import { fakeLastSuccessService } from "../services/last-success-service.fake";

// No collector here remembers its searches, so the last-success service every
// collector is handed holds no time.
const noTimes = fakeLastSuccessService();

// No test here polls an ATS board, so the slug service every collector is
// handed holds none.
const NO_BOARDS = fakeAtsSlugService();

// Collection only hands this to collectors, so no getter needs real behaviour.
const stubSettings: SettingsService = fakeSettingsService();

// A fixed stand-in for the UUID the entry point mints for a real run. These are
// unit tests, so the value is never parsed as a real UUID.
const stubRunId = "test-run-id";

// The date the caller hands over for collected_at. Fixed and clearly not today,
// so a test proving collection uses the argument rather than a clock of its own
// can tell the two apart.
const stubCollectedAt = new Date("2020-01-02T03:04:05.000Z");

// A minimal job that can still travel: a link, a title, and an employer. Every
// JobListEntry field is optional, but a job carrying none of those three is
// dropped by the usability check, so the smallest useful job has all of them.
function makeJob(title: string): JobListEntry {
  return {
    original_url: `https://example.com/${title}`,
    raw_title: title,
    raw_company_name: "Example",
  };
}

// A stand-in collector that remembers whether it ran and what it was handed, so
// a test can check collection's side of the contract without mocks.
interface FakeCollector extends Collector {
  wasCalled: boolean;
  contextReceived: CollectorContext | undefined;
}

function makeCollector(name: string, result: CollectorResult): FakeCollector {
  const fake: FakeCollector = {
    name,
    wasCalled: false,
    contextReceived: undefined,
    async collect(context) {
      fake.wasCalled = true;
      fake.contextReceived = context;
      return result;
    },
  };
  return fake;
}

// A collector that fails outright, the way a real one does on a dead request or
// a page that will not load.
function makeThrowingCollector(name: string, message: string): FakeCollector {
  const fake: FakeCollector = {
    name,
    wasCalled: false,
    contextReceived: undefined,
    async collect(context) {
      fake.wasCalled = true;
      fake.contextReceived = context;
      throw new Error(message);
    },
  };
  return fake;
}

// A stand-in trace service that keeps every event it was handed, so a test can
// read them back. Each call builds its own events array, so no state carries
// between tests.
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
    // No test here reads a summary back, so the fake answers with
    // nothing rather than keeping counts the tests would not check.
    async countsForRun() {
      return [];
    },
    failureCount() {
      return failures;
    },
  };
}

const emptyResult: CollectorResult = { jobs: [], errors: [], warnings: [] };

describe("a collected event is written for every job as it enters the loop", () => {
  test("the event carries step collection, the collector's name, and the job's id", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    const report = await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    const collected = trace.events.find((event) => event.event === "job_collected");
    expect(collected).toMatchObject({
      step: "collection",
      collector: "lever",
      job_id: report.jobs[0]?.id,
    });
  });

  test("the event carries the run id its caller supplied", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events.every((event) => event.run_id === stubRunId)).toBe(true);
  });
});

describe("a job dropped by the usability check gets both a collected and a job_job_abandoned event", () => {
  test("both events exist, in that order, for the same job", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events.map((event) => event.event)).toEqual(["job_collected", "job_abandoned"]);
    expect(trace.events[0]?.job_id).toBe(trace.events[1]?.job_id);
  });
});

describe("a job that passes the usability check gets a collected event and no job_job_abandoned event", () => {
  test("job_abandoned never appears for that job", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    // Normalization writes its own events for this job, so the check is that
    // no job_job_abandoned event exists rather than that collected is the only event.
    const collectionEvents = trace.events.filter((event) => event.step === "collection");
    expect(collectionEvents.map((event) => event.event)).toEqual(["job_collected"]);
  });
});

describe("a job_job_abandoned event's reason is always one of the usability check's codes", () => {
  test("every reason recorded belongs to the set of six codes", async () => {
    // Typed against UnusableCode, so this list stops compiling if job-usable.ts
    // ever adds or renames a code.
    const validCodes: UnusableCode[] = [
      "no_original_url",
      "original_url_not_a_url",
      "no_raw_title",
      "no_company_identity",
      "posting_date_unparseable",
      "posting_updated_date_unparseable",
    ];
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [
        { ...makeJob("A"), original_url: undefined },
        { ...makeJob("B"), original_url: "not-a-url" },
        { ...makeJob("C"), raw_title: undefined },
        { ...makeJob("D"), raw_company_name: undefined },
      ],
      errors: [],
      warnings: [],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    const reasons = trace.events
      .filter((event) => event.event === "job_abandoned")
      .map((event) => event.reason);
    expect(reasons).toHaveLength(4);
    for (const reason of reasons) {
      expect(validCodes).toContain(reason);
    }
  });
});

describe("a malformed URL is abandoned naming itself in the detail", () => {
  test("the reason is original_url_not_a_url and detail carries the offending value", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Designer"), original_url: "not-a-url" }],
      errors: [],
      warnings: [],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    const abandoned = trace.events.find((event) => event.event === "job_abandoned");
    expect(abandoned?.reason).toBe("original_url_not_a_url");
    expect(abandoned?.detail).toBe("not-a-url");
  });
});

describe("a collector that throws leaves no trace event behind", () => {
  test("no trace event exists for its jobs", async () => {
    const trace = makeTraceService();
    const failing = makeThrowingCollector("greenhouse", "board unreachable");
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [failing],
    });
    expect(trace.events).toEqual([]);
  });
});

describe("a collector's own error or warning writes no trace event", () => {
  test("an error string produces no trace event", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("greenhouse", {
      jobs: [],
      errors: ["bad response"],
      warnings: [],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events).toEqual([]);
  });

  test("a warning string produces no trace event", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("greenhouse", {
      jobs: [],
      errors: [],
      warnings: ["board returned no postings"],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events).toEqual([]);
  });
});

describe("a collector that produces no jobs writes no trace events", () => {
  test("trace stays empty", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", emptyResult);
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events).toEqual([]);
  });
});

describe("a limit of 0 writes no trace events", () => {
  test("trace stays empty even though the collector has a job to give", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [collector],
      limit: 0,
    });
    expect(trace.events).toEqual([]);
  });
});

describe("every trace event collection writes carries the collection step", () => {
  test("step reads collection for both collected and job_abandoned events", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer"), { ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings, lastSuccesses: noTimes, atsSlugs: NO_BOARDS,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    // Normalization writes its own events at a different step, so the cleanup
    // is scoped to the two events collection itself is responsible for.
    const collectionEvents = trace.events.filter(
      (event) => event.event === "job_collected" || event.event === "job_abandoned"
    );
    expect(collectionEvents.length).toBeGreaterThan(0);
    for (const event of collectionEvents) {
      expect(event.step).toBe("collection");
    }
  });
});

// The ATS collectors and Dribbble hand over jobs already pointing at the
// employer's own posting, so resolution never sees them. Recording that at
// collection is what lets the run summary say how many jobs arrived needing
// nothing. Inferring it instead — jobs saved minus jobs resolved — mixes two
// different populations, because resolution also picks up jobs collected by
// earlier runs.
describe("a collector that resolved a job itself says so", () => {
  test("a job arriving with is_resolved true gets its own trace row", async () => {
    const trace = makeTraceService();
    await collectJobs({
      settings: fakeSettingsService(),
      lastSuccesses: noTimes,
      atsSlugs: NO_BOARDS,
      collectors: [
        makeCollector("ashby", {
          jobs: [
            {
              original_url: "https://jobs.ashbyhq.com/acme/1",
              raw_title: "Designer",
              raw_company_name: "Acme",
              is_resolved: true,
              resolved_url: "https://jobs.ashbyhq.com/acme/1",
            },
          ],
          errors: [],
          warnings: [],
        }),
      ],
      collectedAt: stubCollectedAt,
      runId: stubRunId,
      trace,
    });

    const resolved = trace.events.filter((event) => event.event === "job_resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      step: "collection",
      collector: "ashby",
      reason: "collector_provided",
    });
  });

  test("a job arriving unresolved gets no such row", async () => {
    const trace = makeTraceService();
    await collectJobs({
      settings: fakeSettingsService(),
      lastSuccesses: noTimes,
      atsSlugs: NO_BOARDS,
      collectors: [
        makeCollector("adzuna", {
          jobs: [
            {
              original_url: "https://adzuna.example/1",
              raw_title: "Designer",
              raw_company_name: "Acme",
            },
          ],
          errors: [],
          warnings: [],
        }),
      ],
      collectedAt: stubCollectedAt,
      runId: stubRunId,
      trace,
    });

    expect(trace.events.filter((event) => event.event === "job_resolved")).toHaveLength(0);
  });

  test("the row names the same job the collected row named", async () => {
    const trace = makeTraceService();
    await collectJobs({
      settings: fakeSettingsService(),
      lastSuccesses: noTimes,
      atsSlugs: NO_BOARDS,
      collectors: [
        makeCollector("ashby", {
          jobs: [
            {
              original_url: "https://jobs.ashbyhq.com/acme/2",
              raw_title: "Designer",
              raw_company_name: "Acme",
              is_resolved: true,
              resolved_url: "https://jobs.ashbyhq.com/acme/2",
            },
          ],
          errors: [],
          warnings: [],
        }),
      ],
      collectedAt: stubCollectedAt,
      runId: stubRunId,
      trace,
    });

    const collected = trace.events.find((event) => event.event === "job_collected");
    const resolved = trace.events.find((event) => event.event === "job_resolved");
    expect(resolved?.job_id).toBe(collected?.job_id);
  });
});
