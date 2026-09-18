import { describe, expect, test } from "vitest";
import type { JobListEntry } from "../types/job-list-entry";
import { dedupeWarnings, type DedupeWarning } from "./dedupe-warnings";

// Dedupe raises one kind of warning and does not fold it. A lookup that threw
// is a fact about one entry the user can go and look at, so a count would hide
// the very thing they need — the opposite of lib/utils/normalization-warnings.ts,
// which folds by design because one broken collector would print 1,800 lines.

const ENTRY: JobListEntry = {
  id: "job-1",
  title: "Sr. Product Designer",
  raw_title: "Senior Product Designer",
  collector: "adzuna",
};

function lookupFailed(overrides: Partial<DedupeWarning> = {}): DedupeWarning {
  return {
    kind: "lookup_failed",
    collector: "adzuna",
    entry: ENTRY,
    thrown: new Error("database is locked"),
    ...overrides,
  } as DedupeWarning;
}

// AC 66. A lookup that throws leaves its entry on the list and saves as its
// own row, so the user is told which job went uncompared.
describe("a database lookup that threw", () => {
  test("carries the collector that produced the job", () => {
    expect(dedupeWarnings([lookupFailed()])[0]?.collector).toBe("adzuna");
  });

  test("names the entry by title and id", () => {
    const [issue] = dedupeWarnings([lookupFailed()]);

    expect(issue.message).toContain("Sr. Product Designer");
    expect(issue.message).toContain("job-1");
  });

  test("carries what the lookup threw", () => {
    const [issue] = dedupeWarnings([lookupFailed()]);

    expect(issue.message).toContain("database is locked");
  });

  test("says the entry stayed on the list", () => {
    const [issue] = dedupeWarnings([lookupFailed()]);

    expect(issue.message.toLowerCase()).toContain("kept");
  });

  test("a thrown value that is not an Error still reads", () => {
    const [issue] = dedupeWarnings([lookupFailed({ thrown: { code: "SQLITE_BUSY" } })]);

    expect(issue.message).toContain("SQLITE_BUSY");
  });

  test("an entry normalization left no title for falls back to its raw title", () => {
    const [issue] = dedupeWarnings([
      lookupFailed({ entry: { id: "job-2", title: "", raw_title: "Product Designer II" } }),
    ]);

    expect(issue.message).toContain("Product Designer II");
  });
});

describe("one warning in, one line out", () => {
  test("every warning produces a line, in the order they arrived", () => {
    const issues = dedupeWarnings([
      lookupFailed({ entry: { id: "job-1", title: "First Job" } }),
      lookupFailed({ entry: { id: "job-2", title: "Second Job" } }),
    ]);

    expect(issues).toHaveLength(2);
    expect(issues[0].message).toContain("First Job");
    expect(issues[1].message).toContain("Second Job");
  });

  test("no warnings produce no lines", () => {
    expect(dedupeWarnings([])).toEqual([]);
  });
});
