import { describe, expect, test } from "vitest";
import { addedJobsReport, type AddedJobsRun } from "./added-jobs-report";
import type { SavedJobOutcome } from "../types/added-job-outcome";

// What the add-external-jobs command prints for a run. The lines are handed
// back rather than printed, so what the command says is proved here without
// capturing output.

function outcome(overrides: Partial<SavedJobOutcome> = {}): SavedJobOutcome {
  return {
    link: "https://careers.dunmore.example/jobs/101",
    jobId: "job-1",
    title: "Product Designer",
    employer: "Dunmore",
    status: "backlog",
    reason: null,
    letThroughReasons: [],
    ...overrides,
  };
}

function run(overrides: Partial<AddedJobsRun> = {}): AddedJobsRun {
  return { outcomes: [], warnings: [], handlers: [], failure: null, ...overrides };
}

const lineFor = (lines: string[], text: string) => lines.find((line) => line.includes(text));

describe("each added job's line", () => {
  test("names its title, its employer and its final status", () => {
    const line = lineFor(addedJobsReport(run({ outcomes: [outcome()] })), "Product Designer");

    expect(line).toContain("Dunmore");
    expect(line).toContain("backlog");
  });

  test("gives the reason a job not in the backlog ended where it did", () => {
    const lines = addedJobsReport(
      run({ outcomes: [outcome({ status: "too far", reason: "no_location_match" })] })
    );

    expect(lineFor(lines, "Product Designer")).toContain("no_location_match");
  });

  test("says a job let through could not be judged for certain, and gives every reason", () => {
    const lines = addedJobsReport(
      run({ outcomes: [outcome({ letThroughReasons: ["page_refused", "no_location"] })] })
    );
    const line = lineFor(lines, "Product Designer");

    expect(line).toContain("could not be judged for certain");
    expect(line).toContain("page_refused");
    expect(line).toContain("no_location");
  });

  test("says nothing of uncertainty for a job judged normally", () => {
    const lines = addedJobsReport(run({ outcomes: [outcome()] }));

    expect(lineFor(lines, "Product Designer")).not.toContain("could not be judged for certain");
  });

  test("names a link that became no job, and why", () => {
    const lines = addedJobsReport(
      run({
        outcomes: [
          {
            link: "the posting Sam sent me",
            jobId: null,
            status: null,
            title: null,
            employer: null,
            reason: "not a web address",
            letThroughReasons: [],
          },
        ],
      })
    );
    const line = lineFor(lines, "the posting Sam sent me");

    expect(line).toContain("not a web address");
  });
});

describe("the warnings", () => {
  test("each warning's message is printed", () => {
    const lines = addedJobsReport(
      run({ warnings: [{ collector: "user", message: 'refused "x": not a web address' }] })
    );

    expect(lineFor(lines, 'refused "x": not a web address')).toBeDefined();
  });
});

describe("a stopped run", () => {
  const stopped = run({
    handlers: [
      { step: "post_collection_save", entries: 1 },
      { step: "post_parsing_save", entries: 1 },
    ],
    failure: { at: "home_location", reason: "The location setting is missing" },
  });

  test("names the step it stopped at and why", () => {
    const line = lineFor(addedJobsReport(stopped), "home_location");

    expect(line).toContain("The location setting is missing");
  });

  test("lists each step that finished before it", () => {
    const lines = addedJobsReport(stopped);

    expect(lineFor(lines, "post_collection_save")).toBeDefined();
    expect(lineFor(lines, "post_parsing_save")).toBeDefined();
  });

  test("a run that finished says nothing about stopping", () => {
    const lines = addedJobsReport(run({ outcomes: [outcome()] }));

    expect(lines.some((line) => line.includes("stopped"))).toBe(false);
  });
});
