import { describe, expect, test } from "vitest";
import { promoteJobs } from "./promotion";
import type { JobListEntry } from "../types/job-list-entry";
import type { TraceEvent, TraceService } from "../services/trace-service";

// Covers only the trace rows the step writes. What it does to a job keeps its
// own coverage in promotion.test.ts and is not re-asserted here.

const RUN_ID = "run-1";
const STEP = "promotion";
const COLLECTED = new Date("2026-09-14T12:00:00.000Z");

function entry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return { id, collector: "greenhouse", collected_at: COLLECTED, ...overrides };
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
  await promoteJobs(jobs, { trace, runId: RUN_ID, step: STEP });
  return trace.events;
}

// AC 80 and 81. A job takes a row entering the step and exactly one row
// leaving it, so a summary heading can say what the step was handed even
// where the step later died.
describe("the rows one job produces", () => {
  test("a promoted job enters and then leaves as promoted", async () => {
    const rows = await rowsFor([entry("relisted")]);

    expect(rows).toEqual([
      {
        run_id: RUN_ID,
        job_id: "relisted",
        step: STEP,
        event: "job_entered",
        collector: "greenhouse",
      },
      {
        run_id: RUN_ID,
        job_id: "relisted",
        step: STEP,
        event: "job_promoted",
        collector: "greenhouse",
      },
    ]);
  });

  // Promotion has one outcome, so its outcome row needs nothing to group by.
  test("neither row names a reason", async () => {
    const rows = await rowsFor([entry("relisted")]);

    expect(rows.map((row) => row.reason)).toEqual([undefined, undefined]);
  });
});

describe("the rows a list produces", () => {
  test("each job writes its own entering and outcome row", async () => {
    const rows = await rowsFor([entry("one"), entry("two")]);

    expect(rows.map((row) => [row.job_id, row.event])).toEqual([
      ["one", "job_entered"],
      ["one", "job_promoted"],
      ["two", "job_entered"],
      ["two", "job_promoted"],
    ]);
  });

  // AC 85. A step handed nothing still runs, and writes nothing.
  test("a step handed no jobs writes no rows", async () => {
    expect(await rowsFor([])).toEqual([]);
  });

  // A row is keyed by job id and collector, so a job carrying neither has
  // nothing to key its record on.
  test("a job missing its collector writes no rows", async () => {
    const rows = await rowsFor([{ id: "no-collector", collected_at: COLLECTED }]);

    expect(rows).toEqual([]);
  });
});

// The step runs outside a job search as well as inside one, so it needs all
// three of the trace service, the run id and the step name before it writes.
describe("a step handed no run to write against", () => {
  test("it still promotes the job it was handed", async () => {
    const result = await promoteJobs([entry("relisted")], {});

    expect(result.jobs[0].status).toBe("backlog");
  });

  test("it writes nothing when it has the service but no run id", async () => {
    const trace = createFakeTraceService();

    await promoteJobs([entry("relisted")], { trace, step: STEP });

    expect(trace.events).toEqual([]);
  });
});
