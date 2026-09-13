import { describe, expect, test } from "vitest";
import { summaryFromTraceCounts } from "./run-summary";
import type { TraceRunCount } from "../services/trace-service";

// The collector names the run was given. They arrive separately from the
// counts because a collector that found nothing writes no trace row at all,
// and "adzuna collected 0 jobs" is the line that says a source went quiet.
const COLLECTORS = ["adzuna", "ashby", "lever"];

function count(
  step: string,
  event: string,
  collector: string,
  n: number,
  reason: string | null = null,
  domain: string | null = null
): TraceRunCount {
  return { step, event, reason, collector, domain, count: n };
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

  test("parsed counts what a parser read, and what it could not", () => {
    const lines = summaryFromTraceCounts(
      [
        count("parsing", "job_parsed", "ashby", 40),
        count("parsing", "parse_failed", "adzuna", 6, "no_parser_for_domain", "myworkdayjobs.com"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("Parsed: 40 jobs");
    expect(lines).toContain("  - 6 jobs could not be parsed");
    expect(lines).toContain("    - myworkdayjobs.com: 6 jobs (no parser)");
  });

  test("a domain no parser owns and a domain whose parser broke are labelled apart", () => {
    const lines = summaryFromTraceCounts(
      [
        count("parsing", "parse_failed", "adzuna", 4, "no_parser_for_domain", "myworkdayjobs.com"),
        count("parsing", "parse_failed", "ashby", 3, "parser_errored", "lever.co"),
        count("parsing", "parse_failed", "ashby", 2, "nothing_parsed", "lever.co"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("    - lever.co: 5 jobs (parser failed)");
    expect(lines).toContain("    - myworkdayjobs.com: 4 jobs (no parser)");
  });

  test("the five domains costing the most jobs are the ones that print", () => {
    const lines = summaryFromTraceCounts(
      [
        count("parsing", "parse_failed", "adzuna", 9, "no_parser_for_domain", "six.com"),
        count("parsing", "parse_failed", "adzuna", 8, "no_parser_for_domain", "five.com"),
        count("parsing", "parse_failed", "adzuna", 7, "no_parser_for_domain", "four.com"),
        count("parsing", "parse_failed", "adzuna", 6, "no_parser_for_domain", "three.com"),
        count("parsing", "parse_failed", "adzuna", 5, "no_parser_for_domain", "two.com"),
        count("parsing", "parse_failed", "adzuna", 4, "no_parser_for_domain", "one.com"),
      ],
      COLLECTORS
    );

    const listed = lines.filter((line) => line.startsWith("    - "));
    expect(listed).toHaveLength(5);
    expect(listed[0]).toBe("    - six.com: 9 jobs (no parser)");
    expect(listed[4]).toBe("    - two.com: 5 jobs (no parser)");
    expect(lines.join("\n")).not.toContain("one.com");
  });

  test("two domains that failed the same number of times print alphabetically", () => {
    const lines = summaryFromTraceCounts(
      [
        count("parsing", "parse_failed", "adzuna", 3, "no_parser_for_domain", "zebra.com"),
        count("parsing", "parse_failed", "adzuna", 3, "no_parser_for_domain", "apple.com"),
      ],
      COLLECTORS
    );

    const listed = lines.filter((line) => line.startsWith("    - "));
    expect(listed).toEqual([
      "    - apple.com: 3 jobs (no parser)",
      "    - zebra.com: 3 jobs (no parser)",
    ]);
  });

  test("a failure with no owned domain counts in the total but has nothing to list", () => {
    const lines = summaryFromTraceCounts(
      [count("parsing", "parse_failed", "adzuna", 2, "no_parser_for_domain", null)],
      COLLECTORS
    );

    expect(lines).toContain("  - 2 jobs could not be parsed");
    expect(lines.filter((line) => line.startsWith("    - "))).toEqual([]);
  });

  test("a run where every job parsed prints no failures and no domains", () => {
    const lines = summaryFromTraceCounts(
      [count("parsing", "job_parsed", "ashby", 12)],
      COLLECTORS
    );

    expect(lines).toContain("Parsed: 12 jobs");
    expect(lines.join("\n")).not.toContain("could not be parsed");
    expect(lines.filter((line) => line.startsWith("    - "))).toEqual([]);
  });

  test("parsing is counted apart from the steps that run after it", () => {
    const lines = summaryFromTraceCounts(
      [
        count("parsing", "job_parsed", "ashby", 3),
        count("post_parsing_dedupe", "abandoned", "ashby", 5, "hard_match_in_list"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("Parsed: 3 jobs");
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
    expect(lines).toContain("Parsed: 0 jobs");
  });

  test("the blocks come out in the order the pipeline runs them", () => {
    const lines = summaryFromTraceCounts(
      [
        count("collection", "collected", "ashby", 100),
        count("post_collection_dedupe", "abandoned", "ashby", 9, "hard_match_in_list"),
        count("resolution", "job_resolved", "ashby", 55, "no_apply_links"),
        count("parsing", "job_parsed", "ashby", 30),
      ],
      COLLECTORS
    );

    const joined = lines.join("\n");
    expect(joined.indexOf("Collected:")).toBeLessThan(joined.indexOf("Dedupe (post collection)"));
    expect(joined.indexOf("Dedupe (post collection)")).toBeLessThan(joined.indexOf("Resolved:"));
    expect(joined.indexOf("Resolved:")).toBeLessThan(joined.indexOf("Parsed:"));
  });
});

describe("one job reads as one job", () => {
  test("the headline numbers drop the plural at one", () => {
    const lines = summaryFromTraceCounts(
      [
        count("collection", "collected", "ashby", 1),
        count("resolution", "job_resolved", "ashby", 1),
      ],
      ["ashby"]
    );

    expect(lines).toContain("Collected: 1 job");
    expect(lines).toContain("  - ashby collected 1 job");
    expect(lines).toContain("Resolved: 1 job");
  });

  test("the detail lines agree with their verb at one", () => {
    const lines = summaryFromTraceCounts(
      [
        count("collection", "job_resolved", "ashby", 1, "collector_provided"),
        count("post_collection_dedupe", "abandoned", "ashby", 1, "hard_match_in_list"),
        count("post_collection_dedupe", "abandoned", "ashby", 1, "matched_db_row"),
        count("resolution", "resolution_failed", "ashby", 1, "posting_gone"),
        count("parsing", "parse_failed", "ashby", 1, "no_parser_for_domain", "myworkdayjobs.com"),
      ],
      ["ashby"]
    );

    expect(lines).toContain("  - 1 job already had a source link");
    expect(lines).toContain("  - 1 job was a duplicate from this collection");
    expect(lines).toContain("  - 1 job was a duplicate of a job already saved");
    expect(lines).toContain("  - 1 job could not be resolved");
    expect(lines).toContain("  - 1 job could not be parsed");
    expect(lines).toContain("    - myworkdayjobs.com: 1 job (no parser)");
  });

  test("zero keeps the plural, because zero jobs is not one job", () => {
    const lines = summaryFromTraceCounts([], ["ashby"]);
    expect(lines).toContain("Collected: 0 jobs");
    expect(lines).toContain("  - ashby collected 0 jobs");
  });
});
