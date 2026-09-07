import { describe, expect, test } from "vitest";
import { saveJobs } from "./save";
import { fakeJobService } from "../job-service.fake";
import type { JobListEntry } from "../job-list-entry";

// The save step is a loop, not a rule. Every decision about what a write
// turns out to be lives in the job service, which has its own tests; what
// this file proves is that the step asks the service once per entry, one at
// a time, and turns the answers into warnings and a returned list.

const COLLECTED = new Date("2026-09-01T10:00:00.000Z");
const PRIORITY_LIST = ["collector:greenhouse", "collector:adzuna"];

function entry(id: string, overrides: JobListEntry = {}): JobListEntry {
  return {
    id,
    collector: "greenhouse",
    collected_at: COLLECTED,
    title: `Job ${id}`,
    ...overrides,
  };
}

function saved(id: string, overrides: JobListEntry = {}): JobListEntry {
  return { ...entry(id), status: "backlog", ...overrides };
}

// AC 51, 51a and 52. Dedupe marks the losing entry, and save honours that
// mark unless the row holds a status the user has acted on.
describe("an entry marked for deletion", () => {
  test("whose row is not active has that row deleted", async () => {
    const rows = [saved("dupe")];

    await saveJobs([entry("dupe", { delete_on_save: true })], {
      jobService: fakeJobService(rows),
      priorityList: PRIORITY_LIST,
    });

    expect(rows).toHaveLength(0);
  });

  test("whose id no row holds writes nothing and creates nothing", async () => {
    const rows: JobListEntry[] = [];

    await saveJobs([entry("ghost", { delete_on_save: true })], {
      jobService: fakeJobService(rows),
      priorityList: PRIORITY_LIST,
    });

    expect(rows).toHaveLength(0);
  });

  test("whose row is active leaves both rows standing", async () => {
    const rows = [saved("applied", { status: "interview" })];

    await saveJobs([entry("applied", { delete_on_save: true })], {
      jobService: fakeJobService(rows),
      priorityList: PRIORITY_LIST,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("interview");
  });

  test("is never written as an ordinary update", async () => {
    const written: string[] = [];
    const rows = [saved("dupe")];
    const service = fakeJobService(rows, {
      async update(candidate) {
        written.push(candidate.id as string);
        return { job: candidate, outcome: "updated" };
      },
    });

    await saveJobs([entry("dupe", { delete_on_save: true })], {
      jobService: service,
      priorityList: PRIORITY_LIST,
    });

    expect(written).toEqual([]);
  });
});

// AC 53 and 54. The user has to open both rows to reconcile them, so the
// refusal is reported by name and never folded into a count.
describe("warning about a delete the guard refused", () => {
  test("raises one warning naming both rows", async () => {
    const rows = [saved("applied", { status: "offer", title: "Staff Designer" })];

    const result = await saveJobs(
      [entry("applied", { delete_on_save: true, title: "Staff Product Designer" })],
      { jobService: fakeJobService(rows), priorityList: PRIORITY_LIST }
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain("Staff Product Designer");
    expect(result.warnings[0]?.message).toContain("Staff Designer");
  });

  test("carries the collector that produced the job", async () => {
    const rows = [saved("applied", { status: "offer" })];

    const result = await saveJobs(
      [entry("applied", { delete_on_save: true, collector: "adzuna" })],
      { jobService: fakeJobService(rows), priorityList: PRIORITY_LIST }
    );

    expect(result.warnings[0]?.collector).toBe("adzuna");
  });

  test("three refusals are three lines, not a count", async () => {
    const rows = [
      saved("a1", { status: "offer" }),
      saved("a2", { status: "test" }),
      saved("a3", { status: "screening" }),
    ];

    const result = await saveJobs(
      [
        entry("a1", { delete_on_save: true }),
        entry("a2", { delete_on_save: true }),
        entry("a3", { delete_on_save: true }),
      ],
      { jobService: fakeJobService(rows), priorityList: PRIORITY_LIST }
    );

    expect(result.warnings).toHaveLength(3);
  });

  test("a delete that went through raises no warning", async () => {
    const result = await saveJobs([entry("dupe", { delete_on_save: true })], {
      jobService: fakeJobService([saved("dupe")]),
      priorityList: PRIORITY_LIST,
    });

    expect(result.warnings).toEqual([]);
  });

  test("an entry marked for deletion that no row holds raises no warning", async () => {
    const result = await saveJobs([entry("ghost", { delete_on_save: true })], {
      jobService: fakeJobService([]),
      priorityList: PRIORITY_LIST,
    });

    expect(result.warnings).toEqual([]);
  });
});

// AC 69. A write that throws is the only thing that stops a job here, and
// the user is told rather than left to find a gap in the database.
describe("warning about a write that threw", () => {
  function throwingService(message: string) {
    return fakeJobService([], {
      async update() {
        throw new Error(message);
      },
    });
  }

  test("raises a warning naming the job that did not land", async () => {
    const result = await saveJobs([entry("lost", { title: "UX Researcher" })], {
      jobService: throwingService("SQLITE_BUSY: database is locked"),
      priorityList: PRIORITY_LIST,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain("UX Researcher");
  });

  test("reports what the write threw", async () => {
    const result = await saveJobs([entry("lost")], {
      jobService: throwingService("SQLITE_BUSY: database is locked"),
      priorityList: PRIORITY_LIST,
    });

    expect(result.warnings[0]?.message).toContain("SQLITE_BUSY: database is locked");
  });

  test("does not stop the entries that follow it", async () => {
    let calls = 0;
    const service = fakeJobService([], {
      async update(candidate) {
        calls += 1;
        if (candidate.id === "lost") throw new Error("write failed");
        return { job: candidate, outcome: "created" };
      },
    });

    const result = await saveJobs([entry("first"), entry("lost"), entry("last")], {
      jobService: service,
      priorityList: PRIORITY_LIST,
    });

    expect(calls).toBe(3);
    expect(result.warnings).toHaveLength(1);
  });

  test("a delete that threw is reported the same way", async () => {
    const service = fakeJobService([saved("dupe")], {
      async delete() {
        throw new Error("delete failed");
      },
    });

    const result = await saveJobs([entry("dupe", { delete_on_save: true })], {
      jobService: service,
      priorityList: PRIORITY_LIST,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain("delete failed");
  });
});

// AC 56, 57 and 58. The step contract in .claude/rules/pipeline-steps.md: it
// takes the whole list, returns it with the warnings it raised, and reaches
// the job table only through the service it was handed.
describe("the step contract", () => {
  test("returns the warnings it raised alongside a job list", async () => {
    const result = await saveJobs([entry("a")], {
      jobService: fakeJobService([]),
      priorityList: PRIORITY_LIST,
    });

    expect(Array.isArray(result.jobs)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  test("passes every entry to the job service it was handed", async () => {
    const seen: string[] = [];
    const service = fakeJobService([], {
      async update(candidate) {
        seen.push(candidate.id as string);
        return { job: candidate, outcome: "created" };
      },
    });

    await saveJobs([entry("a"), entry("b"), entry("c")], {
      jobService: service,
      priorityList: PRIORITY_LIST,
    });

    expect(seen).toEqual(["a", "b", "c"]);
  });

  test("hands the priority list to every write", async () => {
    const lists: (readonly string[])[] = [];
    const service = fakeJobService([], {
      async update(candidate, priorityList) {
        lists.push(priorityList);
        return { job: candidate, outcome: "created" };
      },
    });

    await saveJobs([entry("a"), entry("b")], {
      jobService: service,
      priorityList: PRIORITY_LIST,
    });

    expect(lists).toEqual([PRIORITY_LIST, PRIORITY_LIST]);
  });

  test("finishes each database call before starting the next", async () => {
    let inFlight = 0;
    let overlapped = false;
    const service = fakeJobService([], {
      async update(candidate) {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return { job: candidate, outcome: "created" };
      },
    });

    await saveJobs([entry("a"), entry("b"), entry("c")], {
      jobService: service,
      priorityList: PRIORITY_LIST,
    });

    expect(overlapped).toBe(false);
  });

  test("an empty job list saves nothing and warns about nothing", async () => {
    const rows: JobListEntry[] = [];

    const result = await saveJobs([], {
      jobService: fakeJobService(rows),
      priorityList: PRIORITY_LIST,
    });

    expect(result.jobs).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(rows).toEqual([]);
  });
});

// The returned list is the run's report rather than a hand-off: the next
// step rebuilds its list from a database query. So it carries the row as the
// service wrote it, and a row that was deleted is not reported as saved.
describe("the list the step returns", () => {
  test("carries each job as the service wrote it back", async () => {
    const result = await saveJobs([entry("a")], {
      jobService: fakeJobService([]),
      priorityList: PRIORITY_LIST,
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.id).toBe("a");
    expect(result.jobs[0]?.status).toBe("backlog");
  });

  test("leaves out an entry whose row was deleted", async () => {
    const result = await saveJobs(
      [entry("keep"), entry("dupe", { delete_on_save: true })],
      { jobService: fakeJobService([saved("dupe")]), priorityList: PRIORITY_LIST }
    );

    expect(result.jobs.map((job) => job.id)).toEqual(["keep"]);
  });

  test("leaves out an entry marked for deletion that no row held", async () => {
    const result = await saveJobs([entry("keep"), entry("ghost", { delete_on_save: true })], {
      jobService: fakeJobService([]),
      priorityList: PRIORITY_LIST,
    });

    expect(result.jobs.map((job) => job.id)).toEqual(["keep"]);
  });

  test("keeps an entry whose delete the guard refused", async () => {
    const result = await saveJobs([entry("applied", { delete_on_save: true })], {
      jobService: fakeJobService([saved("applied", { status: "offer" })]),
      priorityList: PRIORITY_LIST,
    });

    expect(result.jobs.map((job) => job.id)).toEqual(["applied"]);
  });

  test("leaves out an entry whose write threw", async () => {
    const service = fakeJobService([], {
      async update(candidate) {
        if (candidate.id === "lost") throw new Error("write failed");
        return { job: candidate, outcome: "created" };
      },
    });

    const result = await saveJobs([entry("kept"), entry("lost")], {
      jobService: service,
      priorityList: PRIORITY_LIST,
    });

    expect(result.jobs.map((job) => job.id)).toEqual(["kept"]);
  });

  test("keeps the order the entries arrived in", async () => {
    const result = await saveJobs([entry("a"), entry("b"), entry("c")], {
      jobService: fakeJobService([]),
      priorityList: PRIORITY_LIST,
    });

    expect(result.jobs.map((job) => job.id)).toEqual(["a", "b", "c"]);
  });
});
