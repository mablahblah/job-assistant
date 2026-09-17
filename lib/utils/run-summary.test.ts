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
        count("collection", "job_collected", "ashby", 60),
        count("collection", "job_collected", "lever", 40),
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
        count("collection", "job_collected", "ashby", 60),
        count("collection", "job_resolved", "ashby", 24, "collector_provided"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("  - 24 jobs already had a source link");
  });

  test("the two kinds of duplicate are reported apart", () => {
    const lines = summaryFromTraceCounts(
      [
        count("collection", "job_collected", "ashby", 100),
        count("post_collection_dedupe", "job_abandoned", "ashby", 9, "hard_match_in_list"),
        count("post_collection_dedupe", "job_abandoned", "lever", 4, "repost_match_in_list"),
        count("post_collection_dedupe", "job_abandoned", "ashby", 7, "matched_db_row"),
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
        count("collection", "job_collected", "ashby", 60),
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
        count("parsing", "parsing_failed", "adzuna", 6, "no_parser_for_domain", "myworkdayjobs.com"),
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
        count("parsing", "parsing_failed", "adzuna", 4, "no_parser_for_domain", "myworkdayjobs.com"),
        count("parsing", "parsing_failed", "ashby", 3, "parser_errored", "lever.co"),
        count("parsing", "parsing_failed", "ashby", 2, "nothing_parsed", "lever.co"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("    - lever.co: 5 jobs (parser failed)");
    expect(lines).toContain("    - myworkdayjobs.com: 4 jobs (no parser)");
  });

  test("the five domains costing the most jobs are the ones that print", () => {
    const lines = summaryFromTraceCounts(
      [
        count("parsing", "parsing_failed", "adzuna", 9, "no_parser_for_domain", "six.com"),
        count("parsing", "parsing_failed", "adzuna", 8, "no_parser_for_domain", "five.com"),
        count("parsing", "parsing_failed", "adzuna", 7, "no_parser_for_domain", "four.com"),
        count("parsing", "parsing_failed", "adzuna", 6, "no_parser_for_domain", "three.com"),
        count("parsing", "parsing_failed", "adzuna", 5, "no_parser_for_domain", "two.com"),
        count("parsing", "parsing_failed", "adzuna", 4, "no_parser_for_domain", "one.com"),
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
        count("parsing", "parsing_failed", "adzuna", 3, "no_parser_for_domain", "zebra.com"),
        count("parsing", "parsing_failed", "adzuna", 3, "no_parser_for_domain", "apple.com"),
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
      [count("parsing", "parsing_failed", "adzuna", 2, "no_parser_for_domain", null)],
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
        count("post_parsing_dedupe", "job_abandoned", "ashby", 5, "hard_match_in_list"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("Parsed: 3 jobs");
  });

  test("a detail line with nothing to report is left out", () => {
    const lines = summaryFromTraceCounts(
      [count("collection", "job_collected", "ashby", 5)],
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
        count("collection", "job_collected", "ashby", 100),
        count("post_collection_dedupe", "job_abandoned", "ashby", 9, "hard_match_in_list"),
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
        count("collection", "job_collected", "ashby", 1),
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
        count("post_collection_dedupe", "job_abandoned", "ashby", 1, "hard_match_in_list"),
        count("post_collection_dedupe", "job_abandoned", "ashby", 1, "matched_db_row"),
        count("resolution", "resolution_failed", "ashby", 1, "posting_gone"),
        count("parsing", "parsing_failed", "ashby", 1, "no_parser_for_domain", "myworkdayjobs.com"),
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

// Phase 9. Three blocks following .claude/rules/run-summary.md: a heading
// carrying what entered, outcome lines that sum to it, and notes that do not.
describe("the three judging steps each print a block", () => {
  function entered(step: string, n: number): TraceRunCount {
    return count(step, "job_entered", "greenhouse", n);
  }

  test("backlog cleanup names what it swept and what it kept", () => {
    const lines = summaryFromTraceCounts(
      [
        entered("backlog_cleanup", 412),
        count("backlog_cleanup", "job_kept", "greenhouse", 375),
        count("backlog_cleanup", "job_expired", "greenhouse", 37, "past_expiration_threshold"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("Backlog cleanup (412 jobs)");
    expect(lines).toContain("  375 jobs kept");
    expect(lines).toContain("   37 jobs expired (reason: past_expiration_threshold)");
  });

  test("promotion says its jobs came from the backlog rather than this run", () => {
    const lines = summaryFromTraceCounts(
      [entered("promotion", 61), count("promotion", "job_promoted", "greenhouse", 61)],
      COLLECTORS
    );

    expect(lines).toContain("Promotion (61 jobs)");
    expect(lines).toContain("  61 jobs promoted into the pipeline");
    expect(lines).toContain("  Note: these came from the backlog, not from this run's collection");
  });

  test("classification names each way a job left it", () => {
    const lines = summaryFromTraceCounts(
      [
        entered("classification", 157),
        count("classification", "job_classified", "greenhouse", 64),
        count("classification", "job_expired", "greenhouse", 32, "past_expiration_threshold"),
        count("classification", "classification_failed", "greenhouse", 48, "no_location_match"),
        count("classification", "classification_failed", "greenhouse", 13, "location_unusable"),
        count("classification", "job_reposted", "greenhouse", 12),
      ],
      COLLECTORS
    );

    expect(lines).toContain("Classification (157 jobs)");
    expect(lines).toContain("   64 jobs were close enough");
    expect(lines).toContain("   32 jobs expired (reason: past_expiration_threshold)");
    expect(lines).toContain("   48 jobs too far (reason: no_location_match)");
    expect(lines).toContain("   13 jobs could not be judged (reason: location_unusable)");
    expect(lines).toContain("  Note: 12 of these were also flagged as reposts");
  });

  // A missing block reads as a step that never ran, which is a different thing
  // from a step that ran and was handed nothing.
  test("a step handed no jobs still shows its heading and its zero", () => {
    const lines = summaryFromTraceCounts([], COLLECTORS);

    expect(lines).toContain("Backlog cleanup (0 jobs)");
    expect(lines).toContain("Promotion (0 jobs)");
    expect(lines).toContain("Classification (0 jobs)");
  });

  // A partial block is otherwise indistinguishable from a complete one.
  test("the step a run died inside says so in its heading", () => {
    const lines = summaryFromTraceCounts(
      [entered("classification", 157), count("classification", "job_classified", "greenhouse", 40)],
      COLLECTORS,
      "classification"
    );

    expect(lines).toContain("Classification (157 jobs) — stopped early");
  });

  test("a run that finished marks no step as stopped early", () => {
    const lines = summaryFromTraceCounts([entered("classification", 157)], COLLECTORS, null);

    expect(lines).toContain("Classification (157 jobs)");
  });
});

// A company row carries no collector, so its trace counts group under a null
// one. Everything below is a company count unless it says otherwise.
function companyCount(
  step: string,
  event: string,
  n: number,
  reason: string | null = null
): TraceRunCount {
  return { step, event, reason, collector: null, domain: null, count: n };
}

// Criterion 74. Alignment scoring is a block of its own, counting jobs.
describe("the alignment scoring block", () => {
  test("its heading counts the jobs scoring was handed", () => {
    const lines = summaryFromTraceCounts(
      [
        count("scoring", "job_entered", "lever", 10),
        count("scoring", "job_scored", "lever", 7),
        count("scoring", "scoring_failed", "lever", 3, "no_posting_url"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("Alignment scoring (10 jobs)");
  });

  test("its lines account for every job it was handed", () => {
    const lines = summaryFromTraceCounts(
      [
        count("scoring", "job_entered", "lever", 10),
        count("scoring", "job_scored", "lever", 7),
        count("scoring", "scoring_failed", "lever", 3, "no_posting_url"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("   7 jobs scored");
    expect(lines).toContain("   3 jobs could not be scored (reason: no_posting_url)");
  });

  // Criterion 76. A missing block reads as a step that never ran.
  test("a run with nothing to score still prints the heading at zero", () => {
    const lines = summaryFromTraceCounts([], COLLECTORS);

    expect(lines).toContain("Alignment scoring (0 jobs)");
  });
});

// Criteria 75, 102 and 103. Company scoring is a second block, and every
// number in it counts companies rather than jobs.
describe("the company scoring block", () => {
  test("its heading counts companies", () => {
    const lines = summaryFromTraceCounts(
      [companyCount("scoring", "company_entered", 4)],
      COLLECTORS
    );

    expect(lines).toContain("Company scoring (4 companies)");
  });

  test("one company reads as one company rather than a bare plural", () => {
    const lines = summaryFromTraceCounts(
      [companyCount("scoring", "company_entered", 1)],
      COLLECTORS
    );

    expect(lines).toContain("Company scoring (1 company)");
  });

  // Criterion 82. A guessed category is an outcome, not a warning.
  test("its outcome lines count companies", () => {
    const lines = summaryFromTraceCounts(
      [
        companyCount("scoring", "company_entered", 4),
        companyCount("scoring", "company_scored", 2),
        companyCount("scoring", "company_partially_scored", 1, "insufficient_research"),
        companyCount("scoring", "company_scoring_failed", 1, "no_company_name"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("  2 companies scored");
    expect(lines).toContain("  1 company partially scored (reason: insufficient_research)");
    expect(lines).toContain("  1 company could not be scored (reason: no_company_name)");
  });

  test("a run with no company to score still prints the heading at zero", () => {
    const lines = summaryFromTraceCounts([], COLLECTORS);

    expect(lines).toContain("Company scoring (0 companies)");
  });
});

// Criterion 80. Being added to a polling list is something true about
// companies already counted above, so it is a note rather than a way out.
describe("companies promoted during a run", () => {
  test("a note says how many were added to a polling list", () => {
    const lines = summaryFromTraceCounts(
      [
        companyCount("scoring", "company_entered", 4),
        companyCount("scoring", "company_scored", 4),
        companyCount("company_promotion", "company_promoted", 2),
      ],
      COLLECTORS
    );

    expect(lines).toContain("  Note: 2 companies were added to a polling list");
  });

  test("no note where nothing was promoted", () => {
    const lines = summaryFromTraceCounts(
      [
        companyCount("scoring", "company_entered", 4),
        companyCount("scoring", "company_scored", 4),
      ],
      COLLECTORS
    );

    expect(lines.join("\n")).not.toContain("added to a polling list");
  });
});

// Criterion 81. Stale judgements are swept at the start of a run, which is
// something true about companies rather than about the jobs the block counts.
describe("company scores cleared during backlog cleanup", () => {
  test("a note says how many lost every score", () => {
    const lines = summaryFromTraceCounts(
      [
        count("backlog_cleanup", "job_entered", "lever", 5),
        count("backlog_cleanup", "job_kept", "lever", 5),
        companyCount("backlog_cleanup", "company_scores_cleared", 3, "past_expiration_threshold"),
      ],
      COLLECTORS
    );

    expect(lines).toContain("  Note: 3 companies lost a stale score");
  });

  test("a note says how many lost only their guessed scores", () => {
    const lines = summaryFromTraceCounts(
      [
        count("backlog_cleanup", "job_entered", "lever", 5),
        count("backlog_cleanup", "job_kept", "lever", 5),
        companyCount(
          "backlog_cleanup",
          "placeholder_company_scores_cleared",
          2,
          "past_expiration_threshold"
        ),
      ],
      COLLECTORS
    );

    expect(lines).toContain("  Note: 2 companies lost a stale guessed score");
  });

  // Both clearings carry one reason, so only the event separates them. A
  // counter reading the reason alone would print each company's note twice.
  test("a full clear prints no guessed-score note", () => {
    const lines = summaryFromTraceCounts(
      [companyCount("backlog_cleanup", "company_scores_cleared", 3, "past_expiration_threshold")],
      COLLECTORS
    );

    expect(lines).not.toContain("  Note: 3 companies lost a stale guessed score");
  });

  test("a guessed-score clear prints no full-clear note", () => {
    const lines = summaryFromTraceCounts(
      [
        companyCount(
          "backlog_cleanup",
          "placeholder_company_scores_cleared",
          2,
          "past_expiration_threshold"
        ),
      ],
      COLLECTORS
    );

    expect(lines).not.toContain("  Note: 2 companies lost a stale score");
  });

  // The note is about companies, so an empty backlog must not hide it.
  test("the note prints even where no job was on the backlog", () => {
    const lines = summaryFromTraceCounts(
      [companyCount("backlog_cleanup", "company_scores_cleared", 3, "past_expiration_threshold")],
      COLLECTORS
    );

    expect(lines).toContain("  Note: 3 companies lost a stale score");
  });
});
