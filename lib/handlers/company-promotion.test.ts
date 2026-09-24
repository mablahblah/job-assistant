import { describe, expect, test } from "vitest";
import { promoteCompanies } from "./company-promotion";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import { unscoredCompany } from "../services/company-service.fake";
import type { AtsSlugRecord } from "../services/ats-slug-service";
import type { CompanyRecord } from "../services/company-service";

const PROMOTION_THRESHOLD = 3.5;

// A company scored on all four categories. The four numbers average to 4, so
// it clears the threshold unless a test says otherwise.
function scoredCompany(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return unscoredCompany({
    id: "c1",
    name: "Good Co",
    match_key: "goodco",
    employee_satisfaction: 4,
    customer_satisfaction: 4,
    work_life_balance: 4,
    political_alignment: 4,
    scored_at: new Date("2026-09-15T00:00:00.000Z"),
    ...overrides,
  });
}

function slugRow(overrides: Partial<AtsSlugRecord> = {}): AtsSlugRecord {
  return {
    id: "s1",
    slug: "goodco",
    company_id: "c1",
    parser: "greenhouse",
    collector: null,
    ...overrides,
  };
}

// Criterion 52. A company that scores well and posts on a board we can poll
// starts being polled directly, instead of reaching us through an aggregator.
describe("a company averaging above the threshold", () => {
  test("its board row gains the collector matching the parser that found it", async () => {
    const rows = [slugRow()];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("greenhouse");
  });

  test("a Lever board gains the Lever collector", async () => {
    const rows = [slugRow({ parser: "lever" })];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("lever");
  });

  test("an Ashby board gains the Ashby collector", async () => {
    const rows = [slugRow({ parser: "ashby" })];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("ashby");
  });

  // A board whose identity takes more than one value is one stored value,
  // its parts joined by a colon, and is promoted exactly like any other.
  test("a Workday board gains the Workday collector", async () => {
    const rows = [slugRow({ parser: "workday", slug: "goodco:wd5:Careers" })];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("workday");
  });

  test("an UltiPro board gains the UltiPro collector", async () => {
    const rows = [
      slugRow({ parser: "ultipro", slug: "goo1000goodco:914e6c7a-35d4-4079-865a-b3a7e7758070" }),
    ];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("ultipro");
  });

  test("a Gem board gains the Gem collector", async () => {
    const rows = [slugRow({ parser: "gem", slug: "goodco" })];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("gem");
  });

  test("a SmartRecruiters board gains the SmartRecruiters collector", async () => {
    const rows = [slugRow({ parser: "smartrecruiters", slug: "GoodCo" })];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("smartrecruiters");
  });

  test("a BambooHR board gains the BambooHR collector", async () => {
    const rows = [slugRow({ parser: "bamboohr", slug: "goodco" })];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("bamboohr");
  });

  test("a Rippling board gains the Rippling collector", async () => {
    const rows = [slugRow({ parser: "rippling", slug: "goodco" })];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("rippling");
  });

  test("a Workable board gains the Workable collector", async () => {
    const rows = [slugRow({ parser: "workable", slug: "goodco" })];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("workable");
  });
});

// Criterion 53. The threshold is a bar to clear, not to reach.
describe("a company averaging at or below the threshold", () => {
  test("its board row gains no collector", async () => {
    const rows = [slugRow()];
    await promoteCompanies(
      [
        scoredCompany({
          employee_satisfaction: 3,
          customer_satisfaction: 4,
          work_life_balance: 3,
          political_alignment: 4,
        }),
      ],
      { promotionThreshold: PROMOTION_THRESHOLD, atsSlugs: fakeAtsSlugService(rows) }
    );

    expect(rows[0]?.collector).toBeNull();
  });
});

// Criterion 54. Dribbble is read by a parser but polled by no collector of
// its own, so a company known only through Dribbble has nowhere to be added.
describe("a company whose only board is one no collector polls", () => {
  test("its board row gains no collector", async () => {
    const rows = [slugRow({ parser: "dribbble" })];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBeNull();
  });
});

// Criteria 55 and 55a. A board is polled by whichever collector claimed it
// first, so a second claim changes nothing and raises nothing.
describe("a company whose board row already carries a collector", () => {
  test("the row is unchanged", async () => {
    const rows = [slugRow({ collector: "greenhouse" })];
    await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBe("greenhouse");
  });

  test("no error is raised", async () => {
    const rows = [slugRow({ collector: "greenhouse" })];
    await expect(
      promoteCompanies([scoredCompany()], {
        promotionThreshold: PROMOTION_THRESHOLD,
        atsSlugs: fakeAtsSlugService(rows),
      })
    ).resolves.toBeDefined();
  });
});

// A company missing a category has no average to test, so it waits for the
// run that finishes scoring it rather than being judged on three numbers.
describe("a company still missing one of its four scores", () => {
  test("its board row gains no collector", async () => {
    const rows = [slugRow()];
    await promoteCompanies([scoredCompany({ political_alignment: null })], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService(rows),
    });

    expect(rows[0]?.collector).toBeNull();
  });
});

// Criterion 64a. A handler hands its list back to its caller.
describe("the list it was handed", () => {
  test("comes back", async () => {
    const result = await promoteCompanies([scoredCompany()], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: fakeAtsSlugService([slugRow()]),
    });

    expect(result.companies.map((company) => company.id)).toEqual(["c1"]);
  });
});

// A board lookup can fail for a reason that has nothing to do with the
// company — a dropped connection, a locked file. Unguarded, one such failure
// throws out of the handler and every company still queued behind it is never
// looked at, even though nothing is wrong with them.
describe("a company whose board lookup fails outright", () => {
  function slugsFailingOn(failingCompanyId: string) {
    const service = fakeAtsSlugService([slugRow(), slugRow({ id: "s2", slug: "otherco", company_id: "c2" })]);
    return {
      ...service,
      listForCompany: async (companyId: string) => {
        if (companyId === failingCompanyId) throw new Error("the database went away");
        return service.listForCompany(companyId);
      },
    };
  }

  test("the companies around it are still considered", async () => {
    const companies = [
      scoredCompany({ id: "c1" }),
      scoredCompany({ id: "c2", name: "Other Co", match_key: "otherco" }),
    ];

    const result = await promoteCompanies(companies, {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: slugsFailingOn("c1"),
    });

    expect(result.companies.map((company) => company.id)).toEqual(["c1", "c2"]);
  });

  test("the failure is reported rather than swallowed", async () => {
    const result = await promoteCompanies([scoredCompany({ id: "c1" })], {
      promotionThreshold: PROMOTION_THRESHOLD,
      atsSlugs: slugsFailingOn("c1"),
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain("the database went away");
  });
});
