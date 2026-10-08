import { describe, expect, test } from "vitest";
import { letJobsThrough, type LetJobsThroughOptions } from "./let-through";
import type { JobListEntry } from "../types/job-list-entry";
import type { TraceEvent, TraceService } from "../services/trace-service";

// Covers only the trace rows the step writes. What it does to a job keeps its
// own coverage in let-through.test.ts and is not re-asserted here.

const RUN_ID = "run-1";
const COLLECTED = new Date("2026-09-14T12:00:00.000Z");

function entry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return { id, collector: "user", collected_at: COLLECTED, ...overrides };
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

async function rowsFor(
  jobs: JobListEntry[],
  after: LetJobsThroughOptions["after"],
  step: string
): Promise<TraceEvent[]> {
  const trace = createFakeTraceService();
  await letJobsThrough(jobs, { after, trace, runId: RUN_ID, step });
  return trace.events;
}

// The run records why it let each job through, and the printed line reads
// that reason back.
describe("the row a job let through produces", () => {
  test("after page reading, it names the job and no_location", async () => {
    const rows = await rowsFor(
      [entry("nowhere", { status: "unparseable" })],
      "parsing",
      "post_parsing_let_through"
    );

    expect(rows).toEqual([
      {
        run_id: RUN_ID,
        job_id: "nowhere",
        step: "post_parsing_let_through",
        event: "job_let_through",
        reason: "no_location",
        collector: "user",
      },
    ]);
  });

  test("after the location check, it names the job and location_unusable", async () => {
    const rows = await rowsFor([entry("unplaced")], "classification", "post_classification_let_through");

    expect(rows).toEqual([
      {
        run_id: RUN_ID,
        job_id: "unplaced",
        step: "post_classification_let_through",
        event: "job_let_through",
        reason: "location_unusable",
        collector: "user",
      },
    ]);
  });
});

describe("the rows a list produces", () => {
  test("a job left as it was writes no row", async () => {
    const rows = await rowsFor(
      [entry("read", { is_parsed: true }), entry("nowhere", { status: "unparseable" })],
      "parsing",
      "post_parsing_let_through"
    );

    expect(rows.map((row) => row.job_id)).toEqual(["nowhere"]);
  });

  test("a step handed no jobs writes no rows", async () => {
    expect(await rowsFor([], "parsing", "post_parsing_let_through")).toEqual([]);
  });

  // A row is keyed by job id and collector, so a job carrying neither has
  // nothing to key its record on.
  test("a job missing its collector writes no rows", async () => {
    const rows = await rowsFor(
      [{ id: "no-collector", collected_at: COLLECTED, status: "unparseable" }],
      "parsing",
      "post_parsing_let_through"
    );

    expect(rows).toEqual([]);
  });
});

// The step needs all three of the trace service, the run id and the step name
// before it writes.
describe("a step handed no run to write against", () => {
  test("it still lets the job through", async () => {
    const result = await letJobsThrough([entry("nowhere", { status: "unparseable" })], { after: "parsing" });

    expect(result.jobs[0]?.status).toBe("backlog");
  });

  test("it writes nothing when it has the service but no run id", async () => {
    const trace = createFakeTraceService();

    await letJobsThrough([entry("nowhere", { status: "unparseable" })], {
      after: "parsing",
      trace,
      step: "post_parsing_let_through",
    });

    expect(trace.events).toEqual([]);
  });
});
