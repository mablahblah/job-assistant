import { describe, expect, test } from "vitest";
import { JOB_LIST_ENTRY_FIELDS, type JobListEntry } from "./job-list-entry";
import {
  CONTESTED_FIELDS,
  DERIVED_AT_WRITE_FIELDS,
  NEVER_WRITTEN_FIELDS,
  POOLED_DATE_FIELDS,
  WINNER_STAMP_FIELDS,
  WRITE_ONCE_FIELDS,
  WRITTEN_THROUGH_FIELDS,
  mergeJobs,
} from "./job-merge";

// greenhouse outranks adzuna, and the hand-entered source outranks both.
const LIST = [
  "collector:user",
  "parser:greenhouse",
  "collector:greenhouse",
  "collector:adzuna",
];

const COLLECTED_AT = new Date("2025-01-01T00:00:00.000Z");
const JAN_05 = new Date("2025-01-05T00:00:00.000Z");
const JAN_10 = new Date("2025-01-10T00:00:00.000Z");

// The two sides used throughout: greenhouse ranks 1, adzuna ranks 3.
const GREENHOUSE = { collector: "greenhouse", parser: "greenhouse" };
const ADZUNA = { collector: "adzuna" };

function merge(
  existing: JobListEntry,
  arriving: JobListEntry,
  list: readonly string[] = LIST
): JobListEntry {
  return mergeJobs(existing, arriving, list, COLLECTED_AT);
}

describe("the field list names every Job column exactly once", () => {
  const named = [
    ...CONTESTED_FIELDS,
    ...WRITTEN_THROUGH_FIELDS,
    ...WINNER_STAMP_FIELDS,
    ...WRITE_ONCE_FIELDS,
    ...POOLED_DATE_FIELDS,
    ...NEVER_WRITTEN_FIELDS,
    ...DERIVED_AT_WRITE_FIELDS,
  ] as string[];

  // delete_on_save is the one job list field that is not a column, so it is
  // the only name dropped before the comparison.
  const columns = JOB_LIST_ENTRY_FIELDS.filter((field) => field !== "delete_on_save");

  test("every Job column is named in one of the groups", () => {
    expect([...named].sort()).toEqual([...columns].sort());
  });

  test("no column is named in two groups", () => {
    expect(new Set(named).size).toBe(named.length);
  });
});

describe("a contested field where only one side is filled", () => {
  test("the filled value wins even though its side ranks worse", () => {
    const result = merge(
      { ...GREENHOUSE, title: undefined },
      { ...ADZUNA, title: "UX Designer" }
    );
    expect(result.title).toBe("UX Designer");
  });

  test("a filled stored value survives an empty arriving one from a better source", () => {
    const result = merge({ ...ADZUNA, title: "UX Designer" }, { ...GREENHOUSE });
    expect(result.title).toBe("UX Designer");
  });

  test("null counts as empty", () => {
    const result = merge({ ...GREENHOUSE, title: null }, { ...ADZUNA, title: "UX Designer" });
    expect(result.title).toBe("UX Designer");
  });

  test("an empty string counts as empty", () => {
    const result = merge({ ...GREENHOUSE, title: "" }, { ...ADZUNA, title: "UX Designer" });
    expect(result.title).toBe("UX Designer");
  });

  // A source that collected nothing cannot be told from one that never
  // looked, so both read as empty.
  test("an empty list counts as empty", () => {
    const result = merge(
      { ...GREENHOUSE, raw_location_list: [] },
      { ...ADZUNA, raw_location_list: ["Austin"] }
    );
    expect(result.raw_location_list).toEqual(["Austin"]);
  });

  test("neither side filled leaves the field empty", () => {
    const result = merge({ ...GREENHOUSE }, { ...ADZUNA });
    expect(result.title ?? null).toBeNull();
  });
});

describe("a contested field both sides fill", () => {
  test("the better-ranked source wins", () => {
    const result = merge(
      { ...ADZUNA, title: "Adzuna Title" },
      { ...GREENHOUSE, title: "Greenhouse Title" }
    );
    expect(result.title).toBe("Greenhouse Title");
  });

  test("the better-ranked source wins whichever side it arrives on", () => {
    const result = merge(
      { ...GREENHOUSE, title: "Greenhouse Title" },
      { ...ADZUNA, title: "Adzuna Title" }
    );
    expect(result.title).toBe("Greenhouse Title");
  });

  test("a listed source beats one absent from the list", () => {
    const result = merge(
      { collector: "nowhere", title: "Unlisted Title" },
      { ...ADZUNA, title: "Adzuna Title" }
    );
    expect(result.title).toBe("Adzuna Title");
  });

  test("a listed source beats an absent one whichever side it arrives on", () => {
    const result = merge(
      { ...ADZUNA, title: "Adzuna Title" },
      { collector: "nowhere", title: "Unlisted Title" }
    );
    expect(result.title).toBe("Adzuna Title");
  });

  // With no ranking to appeal to, changing nothing is the safe move.
  test("both sides absent from the list leaves the stored value standing", () => {
    const result = merge(
      { collector: "nowhere", title: "Stored Title" },
      { collector: "elsewhere", title: "Arriving Title" }
    );
    expect(result.title).toBe("Stored Title");
  });

  // A collector re-finding its own still-listed job every week is ordinary,
  // so an equal-rank contest needs an answer rather than a silent default.
  test("two sides of equal rank let the arriving copy win", () => {
    const result = merge(
      { ...ADZUNA, title: "Stored Title" },
      { ...ADZUNA, title: "Arriving Title" }
    );
    expect(result.title).toBe("Arriving Title");
  });

  test("a side ranks on the better of its collector and its parser", () => {
    // parser:greenhouse ranks 1 and collector:adzuna ranks 3, so the side
    // carrying the parser wins even though its collector ranks worse.
    const result = merge(
      { ...ADZUNA, title: "Adzuna Title" },
      { collector: "nowhere", parser: "greenhouse", title: "Parsed Title" }
    );
    expect(result.title).toBe("Parsed Title");
  });
});

describe("raw_salary merges key by key", () => {
  test("a better-ranked side carrying only a period leaves the figures alone", () => {
    const result = merge(
      { ...ADZUNA, raw_salary: { salary_min: 100000, salary_max: 140000 } },
      { ...GREENHOUSE, raw_salary: { salary_period: "year" } }
    );
    expect(result.raw_salary).toEqual({
      salary_min: 100000,
      salary_max: 140000,
      salary_period: "year",
    });
  });

  test("a key both sides fill goes to the better-ranked side", () => {
    const result = merge(
      { ...ADZUNA, raw_salary: { salary_min: 100000 } },
      { ...GREENHOUSE, raw_salary: { salary_min: 120000 } }
    );
    expect(result.raw_salary).toEqual({ salary_min: 120000 });
  });

  test("a key only the worse-ranked side fills survives", () => {
    const result = merge(
      { ...ADZUNA, raw_salary: { salary_currency: "USD" } },
      { ...GREENHOUSE, raw_salary: { salary_min: 120000 } }
    );
    expect(result.raw_salary).toEqual({ salary_currency: "USD", salary_min: 120000 });
  });

  test("one side carrying no salary at all leaves the other's intact", () => {
    const result = merge({ ...ADZUNA, raw_salary: { salary_min: 100000 } }, { ...GREENHOUSE });
    expect(result.raw_salary).toEqual({ salary_min: 100000 });
  });

  test("neither side carrying a salary leaves the field empty", () => {
    const result = merge({ ...ADZUNA }, { ...GREENHOUSE });
    expect(result.raw_salary ?? null).toBeNull();
  });
});

describe("written-through fields skip the contest", () => {
  test("company_id takes the arriving value, so a later pass can correct it", () => {
    const result = merge(
      { ...GREENHOUSE, company_id: "company-old" },
      { ...ADZUNA, company_id: "company-new" }
    );
    expect(result.company_id).toBe("company-new");
  });

  test("the three phase gates take the arriving values", () => {
    const result = merge(
      { ...GREENHOUSE, is_resolved: false, is_parsed: false, is_classified: false },
      { ...ADZUNA, is_resolved: true, is_parsed: true, is_classified: true }
    );
    expect(result.is_resolved).toBe(true);
    expect(result.is_parsed).toBe(true);
    expect(result.is_classified).toBe(true);
  });

  test("status takes the arriving value", () => {
    const result = merge(
      { ...GREENHOUSE, status: "backlog" },
      { ...ADZUNA, status: "app. sent" }
    );
    expect(result.status).toBe("app. sent");
  });

  // No collector sets a status, so an arriving entry that carries none must
  // not reset a status the user or classification set.
  test("an absent written-through field leaves the stored value standing", () => {
    const result = merge({ ...GREENHOUSE, status: "rejected" }, { ...ADZUNA });
    expect(result.status).toBe("rejected");
  });

  test("an absent company_id leaves the stored one standing", () => {
    const result = merge({ ...GREENHOUSE, company_id: "company-old" }, { ...ADZUNA });
    expect(result.company_id).toBe("company-old");
  });
});

describe("the row records which side won", () => {
  test("the better-ranked side's collector and parser land on the row", () => {
    const result = merge({ ...ADZUNA, title: "a" }, { ...GREENHOUSE, title: "b" });
    expect(result.collector).toBe("greenhouse");
    expect(result.parser).toBe("greenhouse");
  });

  test("the winning side's names land even when it arrives first", () => {
    const result = merge({ ...GREENHOUSE, title: "a" }, { ...ADZUNA, title: "b" });
    expect(result.collector).toBe("greenhouse");
    expect(result.parser).toBe("greenhouse");
  });

  test("an equal-rank contest stamps the arriving side", () => {
    const result = merge(
      { collector: "adzuna", parser: undefined },
      { collector: "adzuna", parser: "greenhouse" }
    );
    expect(result.parser).toBe("greenhouse");
  });

  test("two sides both absent from the list keep the stored names", () => {
    const result = merge({ collector: "nowhere" }, { collector: "elsewhere" });
    expect(result.collector).toBe("nowhere");
  });
});

describe("fields written once on create", () => {
  test("the stored id stands", () => {
    const result = merge(
      { ...GREENHOUSE, id: "job-stored" },
      { ...ADZUNA, id: "job-arriving" }
    );
    expect(result.id).toBe("job-stored");
  });

  test("the stored collected_at stands", () => {
    const stored = new Date("2024-01-01T00:00:00.000Z");
    const result = merge(
      { ...GREENHOUSE, collected_at: stored },
      { ...ADZUNA, collected_at: JAN_10 }
    );
    expect(result.collected_at).toEqual(stored);
  });

  test("an arriving id fills an empty stored one", () => {
    const result = merge({ ...GREENHOUSE }, { ...ADZUNA, id: "job-arriving" });
    expect(result.id).toBe("job-arriving");
  });

  test("neither side carrying collected_at falls back to the date handed in", () => {
    const result = merge({ ...GREENHOUSE }, { ...ADZUNA });
    expect(result.collected_at).toEqual(COLLECTED_AT);
  });
});

describe("the dates are pooled rather than contested", () => {
  test("the earliest becomes the posted date and the latest the updated one", () => {
    const result = merge(
      { ...GREENHOUSE, posting_date: JAN_10 },
      { ...ADZUNA, posting_date: JAN_05 }
    );
    expect(result.posting_date).toEqual(JAN_05);
    expect(result.posting_updated_date).toEqual(JAN_10);
  });

  // The better-ranked side does not get to pick the date, or two collectors
  // disagreeing by hours would look like a repost.
  test("the worse-ranked side's earlier date still wins the posted slot", () => {
    const result = merge(
      { ...ADZUNA, posting_date: JAN_05 },
      { ...GREENHOUSE, posting_date: JAN_10 }
    );
    expect(result.posting_date).toEqual(JAN_05);
  });

  test("one date across both sides leaves the updated date empty", () => {
    const result = merge({ ...GREENHOUSE, posting_date: JAN_05 }, { ...ADZUNA });
    expect(result.posting_date).toEqual(JAN_05);
    expect(result.posting_updated_date ?? null).toBeNull();
  });

  test("no date anywhere falls back to when the job was collected", () => {
    const stored = new Date("2024-01-01T00:00:00.000Z");
    const result = merge({ ...GREENHOUSE, collected_at: stored }, { ...ADZUNA });
    expect(result.posting_date).toEqual(stored);
  });
});

describe("what the merge never writes", () => {
  test("the row timestamps are left off entirely, so Prisma keeps them", () => {
    const result = merge(
      { ...GREENHOUSE, created_at: JAN_05, modified_at: JAN_05 },
      { ...ADZUNA, created_at: JAN_10, modified_at: JAN_10 }
    );
    expect(result).not.toHaveProperty("created_at");
    expect(result).not.toHaveProperty("modified_at");
  });

  test("delete_on_save is not carried onto the merged entry", () => {
    const result = merge({ ...GREENHOUSE }, { ...ADZUNA, delete_on_save: "hard_match_in_list" });
    expect(result).not.toHaveProperty("delete_on_save");
  });
});

// Dedupe collapses two job list entries through this same rule, and neither
// may carry a database row.
describe("two job list entries with no id between them", () => {
  test("the merge runs unchanged", () => {
    const result = merge(
      { ...ADZUNA, title: "Adzuna Title", posting_date: JAN_10 },
      { ...GREENHOUSE, title: "Greenhouse Title", posting_date: JAN_05 }
    );
    expect(result.title).toBe("Greenhouse Title");
    expect(result.posting_date).toEqual(JAN_05);
    expect(result.posting_updated_date).toEqual(JAN_10);
  });

  test("neither side carrying an id leaves the merged entry without one", () => {
    const result = merge({ ...GREENHOUSE }, { ...ADZUNA });
    expect(result.id ?? null).toBeNull();
  });
});

describe("the merge reaches no database", () => {
  test("it is a plain function over two entries and the list", () => {
    const result = mergeJobs(
      { ...ADZUNA, title: "a" },
      { ...GREENHOUSE, title: "b" },
      LIST,
      COLLECTED_AT
    );
    expect(result.title).toBe("b");
  });

  test("an empty priority list leaves the stored values standing", () => {
    const result = merge(
      { ...ADZUNA, title: "Stored Title" },
      { ...GREENHOUSE, title: "Arriving Title" },
      []
    );
    expect(result.title).toBe("Stored Title");
  });
});
