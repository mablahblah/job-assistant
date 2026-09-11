import { describe, expect, test } from "vitest";
import { collectJobs } from "./collection";
import type { Collector, CollectorContext, CollectorResult } from "../collectors/types";
import type { JobListEntry } from "../job-list-entry";
import type { SettingsService } from "../settings-service";
import type { TraceEvent, TraceService } from "../trace-service";
import { fakeSettingsService } from "../settings-service.fake";

// Collection only hands this to collectors, so no getter needs real behaviour.
// It is here to prove it arrives unchanged.
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

// AC 3. Collection is the handler that builds the first job list, so what it
// returns is what every later handler is handed.
describe("collection runs its collectors and returns what they found", () => {
  test("a collector's job comes back stamped with the collector and the date", async () => {
    const collector = makeCollector("lever", {
      jobs: [makeJob("Designer")],
      errors: [],
      warnings: [],
    });

    const result = await collectJobs({
      settings: stubSettings,
      collectors: [collector],
      collectedAt: stubCollectedAt,
      runId: stubRunId,
      trace: makeTraceService(),
    });

    expect(collector.wasCalled).toBe(true);
    expect(result.jobs).toEqual([
      {
        ...makeJob("Designer"),
        id: expect.any(String),
        collector: "lever",
        collected_at: stubCollectedAt,
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
