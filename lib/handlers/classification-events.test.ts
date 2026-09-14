import { describe, expect, test } from "vitest";
import { classifyJobs, type ClassifyJobsOptions } from "./classification";
import type { JobListEntry } from "../types/job-list-entry";
import type { PlaceRecord } from "../services/place-service";
import { fakePlaceService } from "../services/place-service.fake";
import { fakeGeocoder } from "../tools/geocoder.fake";
import type { TraceEvent, TraceService } from "../services/trace-service";

// Covers only the trace rows the step writes. What it decides about a job
// keeps its own coverage in classification.test.ts and is not re-asserted
// here.

const RUN_ID = "run-1";
const STEP = "classification";
const NOW = new Date("2026-09-14T12:00:00.000Z");
const HOME = { latitude: 30.2672, longitude: -97.7431 };

const FRESH = new Date("2026-09-12T12:00:00.000Z");
const STALE = new Date("2026-07-01T12:00:00.000Z");

const AUSTIN: PlaceRecord = {
  lookup_text: "Austin",
  latitude: 30.2672,
  longitude: -97.7431,
  place_type: "city",
  display_name: "Austin, Texas",
  outline: null,
};

const PHILADELPHIA: PlaceRecord = {
  lookup_text: "Philadelphia",
  latitude: 39.9526,
  longitude: -75.1652,
  place_type: "city",
  display_name: "Philadelphia, Pennsylvania",
  outline: null,
};

function entry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return {
    id,
    collector: "greenhouse",
    collected_at: NOW,
    posting_date: FRESH,
    normalized_location_list: ["Austin"],
    normalized_mode_list: ["remote"],
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

function options(overrides: Partial<ClassifyJobsOptions> = {}): ClassifyJobsOptions {
  return {
    repostGapDays: 3,
    expiryThresholdDays: 30,
    referenceInstant: NOW,
    home: HOME,
    radiusMiles: 30,
    places: fakePlaceService([AUSTIN, PHILADELPHIA]),
    geocoder: fakeGeocoder(),
    ...overrides,
  };
}

async function rowsFor(
  jobs: JobListEntry[],
  overrides: Partial<ClassifyJobsOptions> = {}
): Promise<TraceEvent[]> {
  const trace = createFakeTraceService();
  await classifyJobs(jobs, options({ trace, runId: RUN_ID, step: STEP, ...overrides }));
  return trace.events;
}

// AC 80 and 81. A job takes a row entering the step and exactly one row
// recording what the step decided.
describe("the outcome row each verdict produces", () => {
  test("a job close enough reads job_classified with no reason", async () => {
    const rows = await rowsFor([entry("near")]);

    expect(rows.map((row) => [row.event, row.reason])).toEqual([
      ["job_entered", undefined],
      ["job_classified", undefined],
    ]);
  });

  test("a job too old reads job_expired for passing the threshold", async () => {
    const rows = await rowsFor([entry("stale", { posting_date: STALE })]);

    expect(rows.map((row) => [row.event, row.reason])).toEqual([
      ["job_entered", undefined],
      ["job_expired", "past_expiry_threshold"],
    ]);
  });

  test("a job too far reads classification_failed for matching no pair", async () => {
    const rows = await rowsFor([entry("far", { normalized_location_list: ["Philadelphia"] })]);

    expect(rows.map((row) => [row.event, row.reason])).toEqual([
      ["job_entered", undefined],
      ["classification_failed", "no_location_match"],
    ]);
  });

  test("a job whose places could not be read reads classification_failed", async () => {
    const rows = await rowsFor([entry("unreadable", { normalized_location_list: ["Bad Robot"] })]);

    expect(rows.map((row) => [row.event, row.reason])).toEqual([
      ["job_entered", undefined],
      ["classification_failed", "location_unreadable"],
    ]);
  });

  // A refused lookup is, from the job's point of view, a place that could not
  // be read, so it takes the same reason and the job keeps to one outcome row.
  test("a job whose lookup threw reads classification_failed for the same reason", async () => {
    const geocoder = fakeGeocoder({ Berlin: new Error("the mapping service refused") });

    const rows = await rowsFor([entry("threw", { normalized_location_list: ["Berlin"] })], {
      geocoder,
    });

    expect(rows.map((row) => [row.event, row.reason])).toEqual([
      ["job_entered", undefined],
      ["classification_failed", "location_unreadable"],
    ]);
  });
});

// AC 82. The repost row is written before the outcome row, so a job's fate
// still reads off its latest row.
describe("the repost row", () => {
  test("it sits between the entering row and the outcome row", async () => {
    const rows = await rowsFor([
      entry("relisted", {
        posting_date: new Date("2026-09-01T12:00:00.000Z"),
        posting_updated_date: new Date("2026-09-12T12:00:00.000Z"),
      }),
    ]);

    expect(rows.map((row) => row.event)).toEqual([
      "job_entered",
      "job_reposted",
      "job_classified",
    ]);
  });

  test("it names no reason", async () => {
    const rows = await rowsFor([
      entry("relisted", {
        posting_date: new Date("2026-09-01T12:00:00.000Z"),
        posting_updated_date: new Date("2026-09-12T12:00:00.000Z"),
      }),
    ]);

    expect(rows[1].reason).toBeUndefined();
  });

  // AC 112 and 113. A job can be both, and the repost row still comes first.
  test("a job that is both a repost and too old writes both rows in order", async () => {
    const rows = await rowsFor([
      entry("both", {
        posting_date: new Date("2026-06-01T12:00:00.000Z"),
        posting_updated_date: STALE,
      }),
    ]);

    expect(rows.map((row) => row.event)).toEqual(["job_entered", "job_reposted", "job_expired"]);
  });

  test("a job that is no repost writes no repost row", async () => {
    const rows = await rowsFor([entry("near")]);

    expect(rows.map((row) => row.event)).not.toContain("job_reposted");
  });
});

describe("the rows a list produces", () => {
  test("every row carries the run, the step and the job's collector", async () => {
    const rows = await rowsFor([entry("near")]);

    expect(rows[0]).toEqual({
      run_id: RUN_ID,
      job_id: "near",
      step: STEP,
      event: "job_entered",
      collector: "greenhouse",
      reason: undefined,
    });
  });

  test("each job writes its own rows in turn", async () => {
    const rows = await rowsFor([
      entry("near"),
      entry("far", { normalized_location_list: ["Philadelphia"] }),
    ]);

    expect(rows.map((row) => [row.job_id, row.event])).toEqual([
      ["near", "job_entered"],
      ["near", "job_classified"],
      ["far", "job_entered"],
      ["far", "classification_failed"],
    ]);
  });

  // AC 85. A step handed nothing still runs, and writes nothing.
  test("a step handed no jobs writes no rows", async () => {
    expect(await rowsFor([])).toEqual([]);
  });

  // A row is keyed by job id and collector, so a job carrying neither has
  // nothing to key its record on.
  test("a job missing its collector writes no rows", async () => {
    const rows = await rowsFor([{ id: "no-collector", collected_at: NOW, posting_date: FRESH }]);

    expect(rows).toEqual([]);
  });
});

// The step runs outside a job search as well as inside one, so it needs all
// three of the trace service, the run id and the step name before it writes.
describe("a step handed no run to write against", () => {
  test("it still judges the job it was handed", async () => {
    const result = await classifyJobs([entry("near")], options());

    expect(result.jobs[0].location_match).toBe(true);
  });

  test("it writes nothing when it has the service but no run id", async () => {
    const trace = createFakeTraceService();

    await classifyJobs([entry("near")], options({ trace, step: STEP }));

    expect(trace.events).toEqual([]);
  });
});
