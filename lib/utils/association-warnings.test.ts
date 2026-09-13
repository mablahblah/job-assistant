import { describe, expect, test } from "vitest";
import type { CompanyRecord } from "../services/company-service";
import { associationWarnings, type AssociationWarning } from "./association-warnings";

// Association raises two kinds of warning and folds neither. A clash is a
// fact about two company rows, so a count tells the user nothing they can
// act on — the opposite of lib/utils/normalization-warnings.ts, which folds by
// design because one broken collector would otherwise print 1,800 lines.

function namedCompany(id: string, name: string): CompanyRecord {
  return { id, name, match_key: name.toLowerCase(), ats_platform: null, ats_slug: null };
}

function slugCompany(id: string, slug: string): CompanyRecord {
  return { id, name: null, match_key: null, ats_platform: "ashby", ats_slug: slug };
}

// AC 54. A slug that matched nothing on a job carrying no name means a board
// is producing jobs with no employer, which is worth the user's attention.
describe("a job with no name to look up", () => {
  const warning: AssociationWarning = {
    kind: "no_name_for_lookup",
    collector: "greenhouse",
    slug: "unknown-board",
  };

  test("carries the collector that produced the job", () => {
    expect(associationWarnings([warning])[0]?.collector).toBe("greenhouse");
  });

  test("names the slug that matched nothing", () => {
    expect(associationWarnings([warning])[0]?.message).toContain("unknown-board");
  });
});

// AC 55. The user has to find both rows to merge them, so the message names
// the name that could not be written and identifies each company.
describe("a company name another company already holds", () => {
  const warning: AssociationWarning = {
    kind: "company_name_clash",
    collector: "adzuna",
    name: "Acme",
    target: slugCompany("target-id", "acme-boards"),
    heldBy: namedCompany("holder-id", "Acme"),
  };

  test("carries the collector that produced the job", () => {
    expect(associationWarnings([warning])[0]?.collector).toBe("adzuna");
  });

  test("names the name that could not be written", () => {
    expect(associationWarnings([warning])[0]?.message).toContain("Acme");
  });

  test("identifies the company it was for", () => {
    const message = associationWarnings([warning])[0]?.message ?? "";

    expect(message).toContain("target-id");
  });

  test("identifies the company already holding the name", () => {
    const message = associationWarnings([warning])[0]?.message ?? "";

    expect(message).toContain("holder-id");
  });

  // Decision of 2026-09-03: a company known only by its board slug shows
  // that slug where its name goes, because a company holding no name is an
  // ordinary state rather than a fault.
  test("labels a company holding no name by its slug", () => {
    const message = associationWarnings([warning])[0]?.message ?? "";

    expect(message).toContain("acme-boards");
  });
});

// AC 56. Three clashes are three lines. Folding them into "3 name clashes"
// would leave the user knowing something is wrong and unable to act on it.
describe("several clashes in one run", () => {
  const warnings: AssociationWarning[] = [
    {
      kind: "company_name_clash",
      collector: "adzuna",
      name: "First Clash",
      target: slugCompany("t1", "first-board"),
      heldBy: namedCompany("h1", "First Clash"),
    },
    {
      kind: "company_name_clash",
      collector: "jsearch",
      name: "Second Clash",
      target: slugCompany("t2", "second-board"),
      heldBy: namedCompany("h2", "Second Clash"),
    },
    {
      kind: "company_name_clash",
      collector: "adzuna",
      name: "Third Clash",
      target: slugCompany("t3", "third-board"),
      heldBy: namedCompany("h3", "Third Clash"),
    },
  ];

  test("each clash is a line of its own", () => {
    expect(associationWarnings(warnings)).toHaveLength(3);
  });

  test("two clashes from one collector are not folded together", () => {
    const fromAdzuna = associationWarnings(warnings).filter(
      (issue) => issue.collector === "adzuna"
    );

    expect(fromAdzuna).toHaveLength(2);
  });

  test("every line names its own company", () => {
    const messages = associationWarnings(warnings).map((issue) => issue.message);

    expect(messages[0]).toContain("First Clash");
    expect(messages[1]).toContain("Second Clash");
    expect(messages[2]).toContain("Third Clash");
  });
});

// AC 57. A job matched by slug, matched by name, or given a company of its
// own is the step working. None of those three reaches this helper, so an
// empty list is the ordinary result of a healthy run.
describe("a run with nothing wrong", () => {
  test("produces no warnings at all", () => {
    expect(associationWarnings([])).toEqual([]);
  });
});

describe("the two kinds together", () => {
  test("keep the order they arrived in", () => {
    const issues = associationWarnings([
      { kind: "no_name_for_lookup", collector: "lever", slug: "first-slug" },
      {
        kind: "company_name_clash",
        collector: "adzuna",
        name: "Mixed Clash",
        target: slugCompany("t1", "mixed-board"),
        heldBy: namedCompany("h1", "Mixed Clash"),
      },
      { kind: "no_name_for_lookup", collector: "ashby", slug: "last-slug" },
    ]);

    expect(issues.map((issue) => issue.collector)).toEqual(["lever", "adzuna", "ashby"]);
  });
});
