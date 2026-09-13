import { describe, expect, test } from "vitest";
import type { JobListEntry } from "../types/job-list-entry";
import { saveWarnings, type SaveWarning } from "./save-warnings";

// Save raises two kinds of warning and folds neither. A refused delete is a
// fact about two specific job rows the user has to open and reconcile by
// hand, and a failed write is one job that never arrived — a count of either
// tells the user nothing they can act on. This is the deliberate opposite of
// lib/utils/normalization-warnings.ts, which folds because one broken collector
// would otherwise print a line for every one of ~1,800 jobs.

function job(id: string, title: string, extra: JobListEntry = {}): JobListEntry {
  return { id, title, raw_title: `${title} (raw)`, ...extra };
}

// AC 53. The user has to find both rows to reconcile them, so the message
// identifies the arriving duplicate and the active row that refused to go.
describe("a delete the active guardrail refused", () => {
  const warning: SaveWarning = {
    kind: "delete_refused",
    collector: "greenhouse",
    entry: job("duplicate-id", "Senior UX Designer"),
    blockedBy: job("active-id", "Sr. UX Designer", { status: "interview" }),
  };

  test("carries the collector that produced the job", () => {
    expect(saveWarnings([warning])[0]?.collector).toBe("greenhouse");
  });

  test("names the duplicate that was going to be deleted", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("Senior UX Designer");
  });

  test("identifies the duplicate by id", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("duplicate-id");
  });

  test("names the row that refused to go", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("Sr. UX Designer");
  });

  test("identifies the blocking row by id", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("active-id");
  });

  // Decision of 2026-09-06: an active row carries the application history the
  // user is acting on. Naming the status is what explains the refusal.
  test("names the active status that blocked the delete", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("interview");
  });
});

// A job's readable name is its normalized title. Where normalization fell
// back the raw title stands in, and a job carrying neither still has to be
// findable, so the id always rides along.
describe("labelling a job with no title", () => {
  test("falls back to the raw title", () => {
    const message = saveWarnings([
      {
        kind: "delete_refused",
        collector: "adzuna",
        entry: { id: "no-title-id", raw_title: "  Product Designer - Remote  " },
        blockedBy: job("active-id", "Product Designer", { status: "offer" }),
      },
    ])[0]?.message;

    expect(message).toContain("Product Designer - Remote");
  });

  test("still identifies a job carrying neither title by its id", () => {
    const message = saveWarnings([
      {
        kind: "delete_refused",
        collector: "adzuna",
        entry: { id: "bare-id" },
        blockedBy: job("active-id", "Product Designer", { status: "offer" }),
      },
    ])[0]?.message;

    expect(message).toContain("bare-id");
  });
});

// AC 54. Three refused deletes are three lines. Folding them into "3 deletes
// refused" leaves the user knowing something is wrong and unable to act.
describe("several refused deletes in one run", () => {
  const warnings: SaveWarning[] = [
    {
      kind: "delete_refused",
      collector: "adzuna",
      entry: job("d1", "First Duplicate"),
      blockedBy: job("a1", "First Active", { status: "app. sent" }),
    },
    {
      kind: "delete_refused",
      collector: "jsearch",
      entry: job("d2", "Second Duplicate"),
      blockedBy: job("a2", "Second Active", { status: "screening" }),
    },
    {
      kind: "delete_refused",
      collector: "adzuna",
      entry: job("d3", "Third Duplicate"),
      blockedBy: job("a3", "Third Active", { status: "test" }),
    },
  ];

  test("each refusal is a line of its own", () => {
    expect(saveWarnings(warnings)).toHaveLength(3);
  });

  test("two refusals from one collector are not folded together", () => {
    const fromAdzuna = saveWarnings(warnings).filter((issue) => issue.collector === "adzuna");

    expect(fromAdzuna).toHaveLength(2);
  });

  test("every line names its own pair", () => {
    const messages = saveWarnings(warnings).map((issue) => issue.message);

    expect(messages[0]).toContain("First Duplicate");
    expect(messages[0]).toContain("First Active");
    expect(messages[1]).toContain("Second Duplicate");
    expect(messages[1]).toContain("Second Active");
    expect(messages[2]).toContain("Third Duplicate");
    expect(messages[2]).toContain("Third Active");
  });
});

// AC 69. A write that threw is the only way save stops a job. The trace row
// records it for counting; this warning is what tells the user a job they
// collected never reached the database.
describe("a database write that threw", () => {
  const warning: SaveWarning = {
    kind: "db_write_failed",
    collector: "lever",
    entry: job("lost-id", "Staff Product Designer"),
    thrown: new Error("SQLITE_BUSY: database is locked"),
  };

  test("carries the collector that produced the job", () => {
    expect(saveWarnings([warning])[0]?.collector).toBe("lever");
  });

  test("names the job that did not land", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("Staff Product Designer");
  });

  test("identifies the job by id", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("lost-id");
  });

  test("reports what the write threw", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("SQLITE_BUSY: database is locked");
  });

  // A driver can reject with a plain object, which String() flattens to
  // "[object Object]". messageFromThrown renders it as JSON so the cause
  // survives into the line the user reads.
  test("renders a thrown value that is not an Error", () => {
    const message = saveWarnings([
      {
        kind: "db_write_failed",
        collector: "ashby",
        entry: job("lost-id", "Design Lead"),
        thrown: { code: "ECONNRESET" },
      },
    ])[0]?.message;

    expect(message).toContain("ECONNRESET");
  });

  test("each failed write is a line of its own", () => {
    const issues = saveWarnings([
      {
        kind: "db_write_failed",
        collector: "lever",
        entry: job("f1", "First Lost"),
        thrown: new Error("first failure"),
      },
      {
        kind: "db_write_failed",
        collector: "lever",
        entry: job("f2", "Second Lost"),
        thrown: new Error("second failure"),
      },
    ]);

    expect(issues).toHaveLength(2);
    expect(issues[0]?.message).toContain("First Lost");
    expect(issues[1]?.message).toContain("Second Lost");
  });
});

// A run where every delete went through and every write landed is the step
// working. Neither reaches this helper, so an empty list is the ordinary
// result of a healthy run.
describe("a run with nothing wrong", () => {
  test("produces no warnings at all", () => {
    expect(saveWarnings([])).toEqual([]);
  });
});

describe("the two kinds together", () => {
  test("keep the order they arrived in", () => {
    const issues = saveWarnings([
      {
        kind: "db_write_failed",
        collector: "lever",
        entry: job("f1", "Lost Job"),
        thrown: new Error("write failed"),
      },
      {
        kind: "delete_refused",
        collector: "adzuna",
        entry: job("d1", "Duplicate Job"),
        blockedBy: job("a1", "Active Job", { status: "offer" }),
      },
      {
        kind: "db_write_failed",
        collector: "ashby",
        entry: job("f2", "Other Lost Job"),
        thrown: new Error("write failed again"),
      },
    ]);

    expect(issues.map((issue) => issue.collector)).toEqual(["lever", "adzuna", "ashby"]);
  });
});

// AC 64, 65. Resolution marks a job for deletion when its resolution reaches a
// blacklisted site, and the same active-status guardrail can refuse that delete.
// The row that refuses is the job's own, not a duplicate's, so the dedupe
// wording would name one job twice and blame a match that never happened.
describe("a delete refused on a job that reached a blacklisted site", () => {
  const warning: SaveWarning = {
    kind: "delete_refused",
    collector: "adzuna",
    entry: job("bl-job-1", "Lead Product Designer", {
      delete_on_save: "blacklisted_url",
    }),
    blockedBy: job("bl-job-1", "Lead Product Designer", { status: "app. sent" }),
  };

  test("names the blacklist as the cause", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("blacklisted");
  });

  test("does not describe the job as a duplicate", () => {
    expect(saveWarnings([warning])[0]?.message).not.toContain("duplicate");
  });

  test("names the job whose row was kept", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("Lead Product Designer");
  });

  test("identifies that job by id", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("bl-job-1");
  });

  test("names the active status that blocked the delete", () => {
    expect(saveWarnings([warning])[0]?.message).toContain("app. sent");
  });

  test("carries the collector that produced the job", () => {
    expect(saveWarnings([warning])[0]?.collector).toBe("adzuna");
  });
});

// The two refusals share one warning kind, so the reason the entry was marked
// is the only thing telling them apart. A dedupe reason still reads as a
// duplicate rather than being swept into the blacklist wording.
describe("a delete refused on a duplicate carrying its dedupe reason", () => {
  test("still describes the job as a duplicate", () => {
    const message = saveWarnings([
      {
        kind: "delete_refused",
        collector: "greenhouse",
        entry: job("dupe-id", "Senior UX Designer", { delete_on_save: "matched_db_row" }),
        blockedBy: job("active-id", "Sr. UX Designer", { status: "interview" }),
      },
    ])[0]?.message;

    expect(message).toContain("duplicates");
    expect(message).not.toContain("blacklisted");
  });
});
