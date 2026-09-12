import { describe, expect, test } from "vitest";
import { summaryFromTraceCounts } from "./run-summary";
import type { TraceRunCount } from "./trace-service";

// The collector names the run was given. They arrive separately from the
// counts because a collector that found nothing writes no trace row at all,
// and "adzuna collected 0 jobs" is the line that says a source went quiet.
const COLLECTORS = ["adzuna", "ashby", "lever"];

function count(
  step: string,
  event: string,
  collector: string,
  n: number,
  reason: string | null = null
): TraceRunCount {
  return { step, event, reason, collector, count: n };
}

describe("the summary is built from one run's trace rows", () => {
  test("collected names every collector the run was given, including the empty ones", () => {
    const lines = summaryFromTraceCounts(
      [
        count("collection", "collected", "ashby", 60),
        count("collection", "collected", "lever", 40),
      ],
      COLLECTORS
    );

    expect(lines).toContain("Collected: 100 jobs");
    expect(lines).toContain("  - adzuna collected 0 jobs");
    expect(lines).toContain("  - ashby collected 60 jobs");
    expect(lines).toContain("  - lever collected 40 jobs");
  });

  test("jobs a collector resolved itself are counted under collected", () => {
    const lines = summaryFromTraceCounts(
      [
        count("collection", "collected", "ashby", 60),
        count("collection", "job_resolved", "ashby", 24, "collector_provided"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("  - 24 jobs already had a source link");
  });

  test("the two kinds of duplicate are reported apart", () => {
    const lines = summaryFromTraceCounts(
      [
        count("collection", "collected", "ashby", 100),
        count("post_collection_dedupe", "abandoned", "ashby", 9, "hard_match_in_list"),
        count("post_collection_dedupe", "abandoned", "lever", 4, "repost_match_in_list"),
        count("post_collection_dedupe", "abandoned", "ashby", 7, "matched_db_row"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("Dedupe (post collection)");
    expect(lines).toContain("  - 13 jobs were duplicates from this collection");
    expect(lines).toContain("  - 7 jobs were duplicates of jobs already saved");
  });

  test("resolved counts what resolution found and what it could not", () => {
    const lines = summaryFromTraceCounts(
      [
        count("resolution", "job_resolved", "adzuna", 55, "no_apply_links"),
        count("resolution", "resolution_failed", "adzuna", 3, "dead_end"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("Resolved: 55 jobs");
    expect(lines).toContain("  - 3 jobs could not be resolved");
  });

  test("a collector's own resolutions are not counted as resolution's work", () => {
    const lines = summaryFromTraceCounts(
      [
        count("collection", "collected", "ashby", 60),
        count("collection", "job_resolved", "ashby", 60, "collector_provided"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("Resolved: 0 jobs");
  });

  test("a detail line with nothing to report is left out", () => {
    const lines = summaryFromTraceCounts(
      [count("collection", "collected", "ashby", 5)],
      COLLECTORS
    );

    expect(lines.join("\n")).not.toContain("already had a source link");
    expect(lines.join("\n")).not.toContain("could not be resolved");
    expect(lines.join("\n")).not.toContain("duplicates");
  });

  test("a run that traced nothing still names its collectors", () => {
    const lines = summaryFromTraceCounts([], COLLECTORS);

    expect(lines).toContain("Collected: 0 jobs");
    expect(lines).toContain("  - adzuna collected 0 jobs");
    expect(lines).toContain("Resolved: 0 jobs");
  });

  test("the blocks come out in the order the pipeline runs them", () => {
    const lines = summaryFromTraceCounts(
      [
        count("collection", "collected", "ashby", 100),
        count("post_collection_dedupe", "abandoned", "ashby", 9, "hard_match_in_list"),
        count("resolution", "job_resolved", "ashby", 55, "no_apply_links"),
      ],
      COLLECTORS
    );

    const joined = lines.join("\n");
    expect(joined.indexOf("Collected:")).toBeLessThan(joined.indexOf("Dedupe (post collection)"));
    expect(joined.indexOf("Dedupe (post collection)")).toBeLessThan(joined.indexOf("Resolved:"));
  });
});
