import { describe, expect, test } from "vitest";
import { saveJobs } from "./save";
import { fakeJobService } from "../job-service.fake";
import type { JobListEntry } from "../job-list-entry";
import type { TraceEvent, TraceService } from "../trace-service";

// Covers only the trace rows the step writes. What it saves and what it
// warns about keep their own coverage in save.test.ts and are not
// re-asserted here.

const RUN_ID = "run-1";
const STEP = "post_collection_save";
const COLLECTED = new Date("2026-09-01T10:00:00.000Z");
const PRIORITY_LIST = ["collector:greenhouse"];

function entry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return { id, collector: "greenhouse", collected_at: COLLECTED, ...overrides };
}

function saved(id: string, overrides: JobListEntry = {}): JobListEntry {
  return { ...entry(id), status: "backlog", ...overrides };
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
    failureCount() {
      return 0;
    },
  };
}

// AC 64 to 67. The write reports what it turned out to be, and the step
// picks its event from that word rather than working it out a second time.
describe("the event each kind of write produces", () => {
  test("a new row reads job_dbrow_created", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("new")], {
      jobService: fakeJobService([]),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events.map((event) => event.event)).toEqual(["job_dbrow_created"]);
  });

  test("a row taking merged fields reads job_dbrow_updated", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("held", { title: "New Title" })], {
      jobService: fakeJobService([saved("held", { title: "Old Title" })]),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events.map((event) => event.event)).toEqual(["job_dbrow_updated"]);
  });

  test("an active row taking a new status reads job_dbrow_status_updated", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("applied", { status: "offer" })], {
      jobService: fakeJobService([saved("applied", { status: "interview" })]),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events.map((event) => event.event)).toEqual(["job_dbrow_status_updated"]);
  });

  test("a deleted row reads job_dbrow_deleted", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("dupe", { delete_on_save: "hard_match_in_list" })], {
      jobService: fakeJobService([saved("dupe")]),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events.map((event) => event.event)).toEqual(["job_dbrow_deleted"]);
  });

  test("each entry writes exactly one row", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("a"), entry("b"), entry("c")], {
      jobService: fakeJobService([]),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events).toHaveLength(3);
    expect(trace.events.map((event) => event.job_id)).toEqual(["a", "b", "c"]);
  });
});

// AC 89. An active job left alone records nothing worth counting. The cost
// is that such a job enters save with no matching event to leave it by.
describe("what writes no row at all", () => {
  test("an active row left untouched writes nothing", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("applied")], {
      jobService: fakeJobService([saved("applied", { status: "interview" })]),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events).toEqual([]);
  });
});

// AC 85 to 88. A deletion dedupe asked for is counted by the match that
// caused it, so the reason delete_on_save carried rides onto every row the
// deletion produces rather than being dropped at the door.
describe("a deletion dedupe asked for", () => {
  test("a deleted row carries the reason the mark held", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("dupe", { delete_on_save: "repost_match_in_list" })], {
      jobService: fakeJobService([saved("dupe")]),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.event).toBe("job_dbrow_deleted");
    expect(trace.events[0]?.reason).toBe("repost_match_in_list");
  });

  // AC 85. The entry was a fresh copy that lost to a stored row and never
  // reached a row of its own, so it is a dead end rather than a deletion.
  test("an entry marked for deletion that no row holds reads abandoned", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("ghost", { delete_on_save: "matched_db_row" })], {
      jobService: fakeJobService([]),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.event).toBe("abandoned");
    expect(trace.events[0]?.reason).toBe("matched_db_row");
  });

  // AC 86. The row holds application history the user is acting on, so the
  // guard keeps it and the run records which match reached for it.
  test("a delete the guard refused reads job_dbrow_delete_refused", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("applied", { delete_on_save: "hard_match_in_list" })], {
      jobService: fakeJobService([saved("applied", { status: "offer" })]),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.event).toBe("job_dbrow_delete_refused");
    expect(trace.events[0]?.reason).toBe("hard_match_in_list");
  });

  // AC 87. Naming the row that blocked the delete, and the status that made
  // it block, is what lets the pair be reconciled without a second query.
  test("the refused row names the blocking row and its status", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("applied", { delete_on_save: "hard_match_in_list" })], {
      jobService: fakeJobService([saved("applied", { status: "offer" })]),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    const detail = (trace.events[0]?.detail ?? {}) as Record<string, string>;
    expect(detail["blocked_by"]).toBe("applied");
    expect(detail["status"]).toBe("offer");
  });
});

// AC 68 and 70. A job that never reached a row was abandoned wherever it
// happened, so save reuses collection's event name. The step says where and
// the reason says why.
describe("a write that threw", () => {
  function throwingService(message: string) {
    return fakeJobService([], {
      async update() {
        throw new Error(message);
      },
    });
  }

  test("reads abandoned", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("lost")], {
      jobService: throwingService("database is locked"),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events.map((event) => event.event)).toEqual(["abandoned"]);
  });

  test("carries the reason db_write_failed", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("lost")], {
      jobService: throwingService("database is locked"),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.reason).toBe("db_write_failed");
  });

  test("carries the step it happened at, which is what tells it from collection's", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("lost")], {
      jobService: throwingService("database is locked"),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.step).toBe("post_collection_save");
  });

  test("carries what threw as its detail", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("lost")], {
      jobService: throwingService("database is locked"),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.detail).toContain("database is locked");
  });

  // Decision of 2026-09-01: a detail value is cut at 200 characters, which
  // clears every genuine value while still cutting a runaway string.
  test("cuts a detail longer than 200 characters at 200", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("lost")], {
      jobService: throwingService("x".repeat(500)),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(String(trace.events[0]?.detail)).toHaveLength(200);
  });
});

// AC 59. The step contract in .claude/rules/pipeline-steps.md: a step handed
// no run id or no step name writes no trace and still does its work.
describe("the step contract", () => {
  test("no trace service means no rows and the jobs are still saved", async () => {
    const rows: JobListEntry[] = [];

    const result = await saveJobs([entry("a")], {
      jobService: fakeJobService(rows),
      priorityList: PRIORITY_LIST,
      runId: RUN_ID,
      step: STEP,
    });

    expect(rows).toHaveLength(1);
    expect(result.jobs).toHaveLength(1);
  });

  test("no run id means no rows are written and the job is still saved", async () => {
    const trace = createFakeTraceService();
    const rows: JobListEntry[] = [];

    await saveJobs([entry("a")], {
      jobService: fakeJobService(rows),
      priorityList: PRIORITY_LIST,
      trace,
      step: STEP,
    });

    expect(trace.events).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  test("no step name means no rows are written and the job is still saved", async () => {
    const trace = createFakeTraceService();
    const rows: JobListEntry[] = [];

    await saveJobs([entry("a")], {
      jobService: fakeJobService(rows),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
    });

    expect(trace.events).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  test("every row carries the run, the step and the collector its caller set", async () => {
    const trace = createFakeTraceService();

    await saveJobs([entry("a", { collector: "adzuna" })], {
      jobService: fakeJobService([]),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events[0]?.run_id).toBe(RUN_ID);
    expect(trace.events[0]?.step).toBe(STEP);
    expect(trace.events[0]?.collector).toBe("adzuna");
  });

  test("a warning is raised alongside the abandoned row, not instead of it", async () => {
    const trace = createFakeTraceService();

    const result = await saveJobs([entry("lost")], {
      jobService: fakeJobService([], {
        async update() {
          throw new Error("write failed");
        },
      }),
      priorityList: PRIORITY_LIST,
      trace,
      runId: RUN_ID,
      step: STEP,
    });

    expect(trace.events).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });
});
