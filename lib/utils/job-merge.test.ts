import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { JOB_LIST_ENTRY_FIELDS, type JobListEntry } from "../types/job-list-entry";
import {
  CONTESTED_FIELDS,
  DERIVED_AT_WRITE_FIELDS,
  NEVER_WRITTEN_FIELDS,
  POOLED_DATE_FIELDS,
  STRIPPED_AT_WRITE_FIELDS,
  WINNER_WRITTEN_FIELDS,
  WRITE_ONCE_FIELDS,
  WRITTEN_THROUGH_FIELDS,
  mergeJobs,
  pickWinner,
} from "./job-merge";

const libDir = dirname(fileURLToPath(import.meta.url));

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
    ...WINNER_WRITTEN_FIELDS,
    ...WRITE_ONCE_FIELDS,
    ...POOLED_DATE_FIELDS,
    ...NEVER_WRITTEN_FIELDS,
    ...DERIVED_AT_WRITE_FIELDS,
    ...STRIPPED_AT_WRITE_FIELDS,
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
  test("the better-ranked side's collector and parser end on the row", () => {
    const result = merge({ ...ADZUNA, title: "a" }, { ...GREENHOUSE, title: "b" });
    expect(result.collector).toBe("greenhouse");
    expect(result.parser).toBe("greenhouse");
  });

  test("the winning side's names land even when it arrives first", () => {
    const result = merge({ ...GREENHOUSE, title: "a" }, { ...ADZUNA, title: "b" });
    expect(result.collector).toBe("greenhouse");
    expect(result.parser).toBe("greenhouse");
  });

  test("an equal-rank contest writes the arriving side", () => {
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
  test("modified_at is left off entirely, so Prisma keeps setting it", () => {
    const result = merge(
      { ...GREENHOUSE, created_at: JAN_05, modified_at: JAN_05 },
      { ...ADZUNA, created_at: JAN_10, modified_at: JAN_10 }
    );
    expect(result).not.toHaveProperty("modified_at");
  });

  test("delete_on_save is not carried onto the merged entry", () => {
    const result = merge({ ...GREENHOUSE }, { ...ADZUNA, delete_on_save: "hard_match_in_list" });
    expect(result).not.toHaveProperty("delete_on_save");
  });
});

// Dedupe merges two job list entries through this same rule, and neither
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

// A saved job carries a created_at the database filled; an entry the pipeline
// built this run does not. That is the only field telling the two apart.
const CREATED_EARLY = new Date("2024-06-01T00:00:00.000Z");
const CREATED_LATE = new Date("2025-06-01T00:00:00.000Z");

describe("AC 42: the older row's id survives where both sides hold one", () => {
  test("the side with the earlier created_at keeps its id", () => {
    const older = { ...ADZUNA, id: "job-older", created_at: CREATED_EARLY };
    const newer = { ...GREENHOUSE, id: "job-newer", created_at: CREATED_LATE };

    expect(pickWinner(older, newer, LIST).idWinner.id).toBe("job-older");
  });

  test("which argument it arrived as does not decide it", () => {
    const older = { ...ADZUNA, id: "job-older", created_at: CREATED_EARLY };
    const newer = { ...GREENHOUSE, id: "job-newer", created_at: CREATED_LATE };

    expect(pickWinner(newer, older, LIST).idWinner.id).toBe("job-older");
  });
});

describe("AC 43: a side holding a row keeps its id over one that never was", () => {
  test("the saved side wins the id even though the fresh side ranks better", () => {
    const saved = { ...ADZUNA, id: "job-saved", created_at: CREATED_EARLY };
    const fresh = { ...GREENHOUSE, id: "job-fresh" };

    expect(pickWinner(saved, fresh, LIST).idWinner.id).toBe("job-saved");
    expect(pickWinner(fresh, saved, LIST).idWinner.id).toBe("job-saved");
  });
});

describe("AC 44: with no row on either side the priority winner's id survives", () => {
  test("the better-ranked side keeps its id", () => {
    const worse = { ...ADZUNA, id: "job-worse" };
    const better = { ...GREENHOUSE, id: "job-better" };

    expect(pickWinner(worse, better, LIST).idWinner.id).toBe("job-better");
    expect(pickWinner(better, worse, LIST).idWinner.id).toBe("job-better");
  });
});

describe("AC 45: two unsaved sides ranking equal give up either id", () => {
  test("one of the two ids survives", () => {
    const one = { ...ADZUNA, id: "job-one" };
    const two = { ...ADZUNA, id: "job-two" };

    expect(["job-one", "job-two"]).toContain(pickWinner(one, two, LIST).idWinner.id);
  });
});

describe("AC 46: whose data wins is reported apart from whose id survives", () => {
  test("the two answers come back as separate sides", () => {
    const saved = { ...ADZUNA, id: "job-saved", created_at: CREATED_EARLY, title: "Adzuna Title" };
    const fresh = { ...GREENHOUSE, id: "job-fresh", title: "Greenhouse Title" };

    const picked = pickWinner(saved, fresh, LIST);

    expect(picked.dataWinner.title).toBe("Greenhouse Title");
    expect(picked.idWinner.id).toBe("job-saved");
  });
});

describe("AC 47: the merged entry carries a created_at where either side had one", () => {
  test("a created_at on one side is carried onto the merged entry", () => {
    const result = merge({ ...ADZUNA, id: "job-saved", created_at: CREATED_EARLY }, { ...GREENHOUSE });

    expect(result.created_at).toEqual(CREATED_EARLY);
  });

  test("neither side carrying one leaves the merged entry without it", () => {
    const result = merge({ ...GREENHOUSE }, { ...ADZUNA });

    expect(result).not.toHaveProperty("created_at");
  });

  test("a modified_at is never carried, whichever side holds it", () => {
    const result = merge(
      { ...ADZUNA, created_at: CREATED_EARLY, modified_at: JAN_05 },
      { ...GREENHOUSE, modified_at: JAN_10 }
    );

    expect(result).not.toHaveProperty("modified_at");
  });
});

describe("AC 48: the carried created_at belongs to the side whose id survived", () => {
  test("the older row supplies both the id and the birthday, the better source the data", () => {
    const older = {
      ...ADZUNA,
      id: "job-older",
      created_at: CREATED_EARLY,
      title: "Adzuna Title",
    };
    const newer = {
      ...GREENHOUSE,
      id: "job-newer",
      created_at: CREATED_LATE,
      title: "Greenhouse Title",
    };

    const result = merge(older, newer);

    expect(result.id).toBe("job-older");
    expect(result.created_at).toEqual(CREATED_EARLY);
    expect(result.title).toBe("Greenhouse Title");
  });
});

describe("AC 50: the merge names its two sides earlier and later", () => {
  const source = readFileSync(join(libDir, "job-merge.ts"), "utf-8");

  // Argument order decides only the tie-break and which side supplies the
  // collection date, so the names say position rather than database state.
  for (const name of ["mergeJobs", "pickWinner", "contest"]) {
    test(`${name} takes an earlier side and a later side`, () => {
      const signature = source.slice(source.indexOf(`function ${name}(`));
      const parameters = signature.slice(0, signature.indexOf(")"));

      expect(parameters).toMatch(/\bearlier/);
      expect(parameters).toMatch(/\blater/);
      expect(parameters).not.toMatch(/\bexisting|\barriving/);
    });
  }
});
