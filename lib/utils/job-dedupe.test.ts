import { describe, expect, test } from "vitest";
import type { JobListEntry } from "../types/job-list-entry";
import { mergeMatchingJobs } from "./job-dedupe";

// greenhouse outranks adzuna, so the priority contest has an answer.
const LIST = ["parser:greenhouse", "collector:greenhouse", "collector:adzuna"];
const COLLECTED_AT = new Date("2025-03-01T00:00:00.000Z");

const JAN_01 = new Date("2025-01-01T00:00:00.000Z");
const JAN_25 = new Date("2025-01-25T00:00:00.000Z");
const FEB_18 = new Date("2025-02-18T00:00:00.000Z");
const JAN_01_EVENING = new Date("2025-01-01T20:00:00.000Z");
const CREATED_EARLY = new Date("2024-06-01T00:00:00.000Z");

function fold(jobs: JobListEntry[]) {
  return mergeMatchingJobs(jobs, LIST, COLLECTED_AT);
}

// A role at one company, dated, so the company-and-title clause can fire.
function role(id: string, overrides: JobListEntry = {}): JobListEntry {
  return {
    id,
    collector: "adzuna",
    company_id: "c1",
    title: "Sr. Product Designer",
    posting_date: JAN_01,
    ...overrides,
  };
}

describe("AC 51: two matched entries become one, and the loser is marked away", () => {
  test("one entry survives and one is marked", () => {
    const result = fold([
      { id: "a", collector: "adzuna", original_url: "https://jobs.example.com/1?se=aaa" },
      { id: "b", collector: "adzuna", original_url: "https://jobs.example.com/1?se=bbb" },
    ]);

    expect(result.jobs).toHaveLength(1);
    expect(result.folds).toHaveLength(1);
    expect(result.folds[0].loser.delete_on_save).toBe("hard_match_in_list");
  });

  test("a surviving entry is never marked away", () => {
    const result = fold([
      { id: "a", collector: "adzuna", original_url: "https://jobs.example.com/1" },
      { id: "b", collector: "adzuna", original_url: "https://jobs.example.com/1" },
    ]);

    expect(result.jobs[0]).not.toHaveProperty("delete_on_save");
  });

  test("a repost match marks its loser with the repost reason", () => {
    const result = fold([role("a"), role("b", { posting_date: JAN_25 })]);

    expect(result.folds[0].loser.delete_on_save).toBe("repost_match_in_list");
  });

  test("dates under a day apart mark the loser as a hard match", () => {
    const result = fold([role("a"), role("b", { posting_date: JAN_01_EVENING })]);

    expect(result.folds[0].loser.delete_on_save).toBe("hard_match_in_list");
  });
});

describe("AC 52: matches chain, so a connected run becomes one job", () => {
  test("three entries connected in a line leave one survivor", () => {
    const result = fold([
      { id: "a", collector: "adzuna", original_url: "https://jobs.example.com/1" },
      {
        id: "b",
        collector: "adzuna",
        original_url: "https://jobs.example.com/1",
        resolved_url: "https://boards.greenhouse.io/acme/jobs/7",
      },
      { id: "c", collector: "adzuna", resolved_url: "https://boards.greenhouse.io/acme/jobs/7" },
    ]);

    expect(result.jobs).toHaveLength(1);
    expect(result.folds).toHaveLength(2);
  });

  test("an entry connecting two groups already apart collapses all of them", () => {
    const result = fold([
      { id: "a", collector: "adzuna", original_url: "https://jobs.example.com/1" },
      { id: "b", collector: "adzuna", resolved_url: "https://boards.greenhouse.io/acme/jobs/7" },
      {
        id: "c",
        collector: "adzuna",
        original_url: "https://jobs.example.com/1",
        resolved_url: "https://boards.greenhouse.io/acme/jobs/7",
      },
    ]);

    expect(result.jobs).toHaveLength(1);
    expect(result.folds).toHaveLength(2);
  });
});

describe("AC 53: a chain holds even where its two ends fall outside the window", () => {
  test("three reposts at 24-day steps become one job", () => {
    // a to b is 24 days and b to c is 24 days, but a to c is 48.
    const result = fold([
      role("a"),
      role("b", { posting_date: JAN_25 }),
      role("c", { posting_date: FEB_18 }),
    ]);

    expect(result.jobs).toHaveLength(1);
    expect(result.folds).toHaveLength(2);
  });

  test("the two ends alone are left as two jobs", () => {
    const result = fold([role("a"), role("c", { posting_date: FEB_18 })]);

    expect(result.jobs).toHaveLength(2);
    expect(result.folds).toHaveLength(0);
  });
});

describe("AC 54: every fold runs through pickWinner", () => {
  test("the side holding a database row keeps its id over a better-ranked one", () => {
    const result = fold([
      role("saved", { created_at: CREATED_EARLY }),
      role("fresh", { collector: "greenhouse", posting_date: JAN_25 }),
    ]);

    expect(result.jobs[0].id).toBe("saved");
    expect(result.folds[0].loser.id).toBe("fresh");
  });

  test("the better-ranked side's data wins even where the other keeps the id", () => {
    const result = fold([
      role("saved", { created_at: CREATED_EARLY, raw_title: "Adzuna Title" }),
      role("fresh", {
        collector: "greenhouse",
        posting_date: JAN_25,
        raw_title: "Greenhouse Title",
      }),
    ]);

    expect(result.jobs[0].raw_title).toBe("Greenhouse Title");
  });

  test("with no row on either side the priority winner keeps its id", () => {
    const result = fold([
      role("worse"),
      role("better", { collector: "greenhouse", posting_date: JAN_25 }),
    ]);

    expect(result.jobs[0].id).toBe("better");
  });
});

describe("AC 56: the list compare stops at the first clause that matches", () => {
  test("two entries matching on link and on company and title report the link", () => {
    const result = fold([
      role("a", { original_url: "https://jobs.example.com/1?se=aaa" }),
      role("b", { original_url: "https://jobs.example.com/1?se=bbb", posting_date: JAN_25 }),
    ]);

    expect(result.folds[0].clause).toBe("original_url");
  });

  test("a pair with no link match falls through to company and title", () => {
    const result = fold([role("a"), role("b", { posting_date: JAN_25 })]);

    expect(result.folds[0].clause).toBe("company_and_title");
  });
});

describe("AC 57: a list holding no matches comes back untouched", () => {
  test("every entry survives", () => {
    const jobs = [
      { id: "a", collector: "adzuna", original_url: "https://jobs.example.com/1" },
      { id: "b", collector: "adzuna", original_url: "https://jobs.example.com/2" },
      { id: "c", collector: "adzuna", original_url: "https://jobs.example.com/3" },
    ];

    const result = fold(jobs);

    expect(result.jobs).toEqual(jobs);
    expect(result.folds).toHaveLength(0);
  });

  test("an empty list folds to an empty list", () => {
    const result = fold([]);

    expect(result.jobs).toEqual([]);
    expect(result.folds).toEqual([]);
  });

  test("nothing on the list it was handed is mutated", () => {
    const one = role("a");
    const two = role("b", { posting_date: JAN_25 });
    const jobs = [one, two];

    fold(jobs);

    expect(jobs).toEqual([one, two]);
    expect(one).not.toHaveProperty("delete_on_save");
    expect(two).not.toHaveProperty("delete_on_save");
  });
});

describe("AC 58: the merge pools the dates and dedupe writes none of its own", () => {
  test("the earliest becomes the posted date and the latest the updated one", () => {
    const result = fold([role("a"), role("b", { posting_date: JAN_25 })]);

    expect(result.jobs[0].posting_date).toEqual(JAN_01);
    expect(result.jobs[0].posting_updated_date).toEqual(JAN_25);
  });

  test("a pair carrying one date between them leaves the updated date empty", () => {
    const result = fold([
      { id: "a", collector: "adzuna", original_url: "https://x.example.com/1", posting_date: JAN_01 },
      { id: "b", collector: "adzuna", original_url: "https://x.example.com/1" },
    ]);

    expect(result.jobs[0].posting_date).toEqual(JAN_01);
    expect(result.jobs[0].posting_updated_date ?? null).toBeNull();
  });
});

describe("a fold names the partner it merged into at that moment", () => {
  // Three unsaved entries of equal rank, so each fold hands the id to the
  // later side and the surviving id moves along the chain as it collapses.
  const chain = () => [
    role("a"),
    role("b", { posting_date: JAN_25 }),
    role("c", { posting_date: FEB_18 }),
  ];

  test("each fold names the id its partner held at that moment", () => {
    const result = fold(chain());

    expect(result.folds.map((merged) => [merged.loser.id, merged.becameId])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  // Naming the last survivor would merge the middle page, and a flow
  // diagram is drawn from edges rather than from endpoints.
  test("the first fold does not name the survivor the chain ended on", () => {
    const result = fold(chain());

    expect(result.jobs[0].id).toBe("c");
    expect(result.folds[0].becameId).not.toBe(result.jobs[0].id);
  });
});
