import { describe, expect, test } from "vitest";
import { collectJobs } from "./collection";
import type { Collector, CollectorContext, CollectorResult } from "../collectors/types";
import type { JobListEntry } from "../job-list-entry";
import type { SettingsService } from "../settings-service";
import type { UnusableCode } from "../collectors/job-usable";
import type { TraceEvent, TraceService } from "../trace-service";
import { fakeSettingsService } from "../settings-service.fake";

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
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    const collected = trace.events.find((event) => event.event === "collected");
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
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events.every((event) => event.run_id === stubRunId)).toBe(true);
  });
});

describe("a job dropped by the usability check gets both a collected and an abandoned event", () => {
  test("both events exist, in that order, for the same job", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [{ ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    expect(trace.events.map((event) => event.event)).toEqual(["collected", "abandoned"]);
    expect(trace.events[0]?.job_id).toBe(trace.events[1]?.job_id);
  });
});

describe("a job that passes the usability check gets a collected event and no abandoned event", () => {
  test("abandoned never appears for that job", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    // Normalization writes its own events for this job, so the check is that
    // no abandoned event exists rather than that collected is the only event.
    const collectionEvents = trace.events.filter((event) => event.step === "collection");
    expect(collectionEvents.map((event) => event.event)).toEqual(["collected"]);
  });
});

describe("an abandoned event's reason is always one of the usability check's codes", () => {
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
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    const reasons = trace.events
      .filter((event) => event.event === "abandoned")
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
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    const abandoned = trace.events.find((event) => event.event === "abandoned");
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
      settings: stubSettings,
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
      settings: stubSettings,
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
      settings: stubSettings,
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
      settings: stubSettings,
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
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
      limit: 0,
    });
    expect(trace.events).toEqual([]);
  });
});

describe("every trace event collection writes carries the collection step", () => {
  test("step reads collection for both collected and abandoned events", async () => {
    const trace = makeTraceService();
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer"), { ...makeJob("Researcher"), raw_title: undefined }],
      errors: [],
      warnings: [],
    });
    await collectJobs({
      collectedAt: stubCollectedAt,
      settings: stubSettings,
      runId: stubRunId,
      trace,
      collectors: [collector],
    });
    // Normalization writes its own events at a different step, so the cleanup
    // is scoped to the two events collection itself is responsible for.
    const collectionEvents = trace.events.filter(
      (event) => event.event === "collected" || event.event === "abandoned"
    );
    expect(collectionEvents.length).toBeGreaterThan(0);
    for (const event of collectionEvents) {
      expect(event.step).toBe("collection");
    }
  });
});
