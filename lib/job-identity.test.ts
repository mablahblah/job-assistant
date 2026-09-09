import { describe, expect, test } from "vitest";
import type { JobListEntry } from "./job-list-entry";
import { matchingClause } from "./job-identity";

const JAN_01 = new Date("2025-01-01T00:00:00.000Z");
const JAN_20 = new Date("2025-01-20T00:00:00.000Z");
const JAN_31 = new Date("2025-01-31T00:00:00.000Z");
const FEB_01 = new Date("2025-02-01T00:00:00.000Z");
const MAR_01 = new Date("2025-03-01T00:00:00.000Z");

// The company-and-title pair used wherever the clause is meant to fire: same
// company row, same normalized title, dates a few weeks apart.
function sameRole(overrides: JobListEntry = {}): JobListEntry {
  return { company_id: "c1", title: "Sr. Product Designer", posting_date: JAN_01, ...overrides };
}

describe("AC 24: two entries whose original-url keys match are one job", () => {
  test("two links for one posting differing only in their query string match", () => {
    const a: JobListEntry = { original_url: "https://www.adzuna.com/land/ad/123?se=aaa" };
    const b: JobListEntry = { original_url: "https://www.adzuna.com/land/ad/123?se=bbb" };

    expect(matchingClause(a, b)).toBe("original_url");
  });

  test("two links pointing at different postings do not match", () => {
    const a: JobListEntry = { original_url: "https://www.adzuna.com/land/ad/123" };
    const b: JobListEntry = { original_url: "https://www.adzuna.com/land/ad/456" };

    expect(matchingClause(a, b)).toBeNull();
  });
});

describe("AC 25: two entries whose resolved-url keys match are one job", () => {
  test("the clause fires where the original urls are different links", () => {
    const a: JobListEntry = {
      original_url: "https://www.adzuna.com/land/ad/123",
      resolved_url: "https://boards.greenhouse.io/acme/jobs/7?utm_source=adzuna",
    };
    const b: JobListEntry = {
      original_url: "https://jsearch.example.com/job/999",
      resolved_url: "https://boards.greenhouse.io/acme/jobs/7",
    };

    expect(matchingClause(a, b)).toBe("resolved_url");
  });
});

describe("AC 26: a shared company and title inside 30 days is one job", () => {
  test("dates 19 days apart match", () => {
    expect(matchingClause(sameRole(), sameRole({ posting_date: JAN_20 }))).toBe(
      "company_and_title"
    );
  });

  test("dates exactly 30 days apart still match", () => {
    expect(matchingClause(sameRole(), sameRole({ posting_date: JAN_31 }))).toBe(
      "company_and_title"
    );
  });

  test("a different company with the same title is two jobs", () => {
    expect(matchingClause(sameRole(), sameRole({ company_id: "c2" }))).toBeNull();
  });
});

describe("AC 27: a shared company and title more than 30 days apart is two jobs", () => {
  test("dates 59 days apart do not match", () => {
    expect(matchingClause(sameRole(), sameRole({ posting_date: MAR_01 }))).toBeNull();
  });

  test("dates a day past the window do not match", () => {
    expect(matchingClause(sameRole(), sameRole({ posting_date: FEB_01 }))).toBeNull();
  });
});

describe("AC 28: a side's updated posting date is the date the window reads", () => {
  test("an updated date inside the window matches where the posted date would not", () => {
    const a = sameRole({ posting_date: JAN_01, posting_updated_date: FEB_01 });
    const b = sameRole({ posting_date: FEB_01 });

    expect(matchingClause(a, b)).toBe("company_and_title");
  });

  test("an updated date outside the window does not match where the posted date would", () => {
    const a = sameRole({ posting_date: JAN_01, posting_updated_date: MAR_01 });
    const b = sameRole({ posting_date: JAN_01 });

    expect(matchingClause(a, b)).toBeNull();
  });
});

describe("AC 29: a side carrying only a posted date has that read as its latest", () => {
  test("two posted dates inside the window match", () => {
    const a = sameRole({ posting_date: JAN_01, posting_updated_date: null });
    const b = sameRole({ posting_date: JAN_20, posting_updated_date: null });

    expect(matchingClause(a, b)).toBe("company_and_title");
  });
});

describe("AC 30: a side carrying no date at all silences the company-and-title clause", () => {
  test("the clause does not fire where one side has no date", () => {
    const a = sameRole({ posting_date: null });
    const b = sameRole();

    expect(matchingClause(a, b)).toBeNull();
  });

  test("the clause does not fire where neither side has a date", () => {
    const a = sameRole({ posting_date: null });
    const b = sameRole({ posting_date: null });

    expect(matchingClause(a, b)).toBeNull();
  });
});

describe("AC 31: a missing resolved url silences the resolved-url clause", () => {
  test("the clause does not fire where only one side carries a resolved url", () => {
    const a: JobListEntry = {
      original_url: "https://www.adzuna.com/land/ad/123",
      resolved_url: "https://boards.greenhouse.io/acme/jobs/7",
    };
    const b: JobListEntry = { original_url: "https://jsearch.example.com/job/999" };

    expect(matchingClause(a, b)).toBeNull();
  });
});

describe("AC 32: two entries with no clause whose fields are present on both are two jobs", () => {
  test("a link on one side and a company and title on the other match on nothing", () => {
    const a: JobListEntry = { original_url: "https://www.adzuna.com/land/ad/123" };
    const b: JobListEntry = sameRole();

    expect(matchingClause(a, b)).toBeNull();
  });

  test("two entries carrying nothing at all match on nothing", () => {
    expect(matchingClause({}, {})).toBeNull();
  });
});

describe("AC 33: two posting ids on one board are two openings at that company", () => {
  test("the company-and-title clause is vetoed where the resolved links share a host", () => {
    const a = sameRole({ resolved_url: "https://boards.greenhouse.io/acme/jobs/7" });
    const b = sameRole({ posting_date: JAN_20, resolved_url: "https://boards.greenhouse.io/acme/jobs/8" });

    expect(matchingClause(a, b)).toBeNull();
  });

  test("resolved links on different hosts do not veto the clause", () => {
    const a = sameRole({ resolved_url: "https://boards.greenhouse.io/acme/jobs/7" });
    const b = sameRole({ posting_date: JAN_20, resolved_url: "https://jobs.lever.co/acme/8" });

    expect(matchingClause(a, b)).toBe("company_and_title");
  });
});

describe("AC 34: the veto stops the weakest clause and not a link match", () => {
  test("vetoed entries whose original-url keys match are still one job", () => {
    const a = sameRole({
      original_url: "https://www.adzuna.com/land/ad/123?se=aaa",
      resolved_url: "https://boards.greenhouse.io/acme/jobs/7",
    });
    const b = sameRole({
      posting_date: JAN_20,
      original_url: "https://www.adzuna.com/land/ad/123?se=bbb",
      resolved_url: "https://boards.greenhouse.io/acme/jobs/8",
    });

    expect(matchingClause(a, b)).toBe("original_url");
  });
});

describe("AC 35: no clause reads which collector found a job", () => {
  test("two entries from one collector still match on company and title", () => {
    const a = sameRole({ collector: "jsearch" });
    const b = sameRole({ posting_date: JAN_20, collector: "jsearch" });

    expect(matchingClause(a, b)).toBe("company_and_title");
  });
});

describe("AC 36: the company-and-title clause reads the normalized title", () => {
  test("one role spelled differently by two sources matches", () => {
    const a = sameRole({ raw_title: "Senior Product Designer (Remote)" });
    const b = sameRole({ posting_date: JAN_20, raw_title: "Sr. Product Designer - Design" });

    expect(matchingClause(a, b)).toBe("company_and_title");
  });

  test("two roles sharing a raw title but not a normalized one do not match", () => {
    const a = sameRole({ title: "Sr. Product Designer", raw_title: "Product Designer" });
    const b = sameRole({ title: "Jr. Product Designer", raw_title: "Product Designer" });

    expect(matchingClause(a, b)).toBeNull();
  });
});
