import { describe, expect, test } from "vitest";
import { enrichCompanies, type EnrichCompaniesOptions } from "./enrichment";
import { fakeCompanyService, unscoredCompany } from "../services/company-service.fake";
import { fakeCompanySearch, type FakeCompanySearch } from "../tools/company-search.fake";
import { MissingSearchCredentialError } from "../tools/company-search";
import type { CompanyRecord } from "../services/company-service";

const NOW = new Date("2026-02-01T00:00:00.000Z");

const FIGMA_QUERY = "Figma headquarters address, phone number, domain url";

const GOOD_RESULTS = [
  { title: "Contact Information", text: "1 Nowhere Road, Nowhere, ZZ 00000" },
  {
    title: "Figma Inc. - Company Profile",
    text: "Headquarters: 760 Market Street, San Francisco, CA 94102. Phone: 415-555-0142. Website: www.figma.com",
  },
];

interface Built extends EnrichCompaniesOptions {
  companyList: CompanyRecord[];
  search: FakeCompanySearch;
}

function build(
  companyList: CompanyRecord[] = [unscoredCompany({ id: "co-1", name: "Figma" })],
  table: Parameters<typeof fakeCompanySearch>[0] = { [FIGMA_QUERY]: GOOD_RESULTS }
): Built {
  const search = fakeCompanySearch(table);
  return {
    companyList,
    companies: fakeCompanyService(companyList),
    search,
    now: NOW,
  };
}

// Criteria 45, 46, 47 reaching the employer through this handler, and 48 —
// the values come from the first result whose title names the employer,
// never from one that named somebody else.
describe("a search that found the employer", () => {
  test("the employer holds the address, the phone number and the website", async () => {
    const built = build();

    await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.companyList[0]).toMatchObject({
      address: "760 Market Street, San Francisco, CA 94102",
      phone: "415-555-0142",
      website: "https://www.figma.com",
    });
  });

  test("the employer is marked done", async () => {
    const built = build();

    await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.companyList[0]?.enriched_at).toEqual(NOW);
  });

  test("the run reports what was filled in", async () => {
    const built = build();

    const result = await enrichCompanies([{ company_id: "co-1" }], built);

    expect(result.companies[0]).toMatchObject({
      company_id: "co-1",
      company_name: "Figma",
      outcome: "filled",
    });
  });

  // Criterion 58.
  test("the employer was marked as being searched before the search started", async () => {
    const built = build([unscoredCompany({ id: "co-1", name: "Figma" })], {
      [FIGMA_QUERY]: new Error("the service is down"),
    });

    await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.companyList[0]?.enrichment_status).toBe("pending");
  });
});

// Criteria 49, 50, 55 and 77.
describe("a search where no result names the employer", () => {
  const strangers = [
    { title: "Privacy Policy", text: "12 Elsewhere Ave, Nowhere, ZZ 00000. Phone: 555-555-5555" },
    { title: "Terms and Conditions of Use", text: "Website: www.stranger.com" },
  ];

  test("no address, no phone number and no website are written", async () => {
    const built = build([unscoredCompany({ id: "co-1", name: "Figma" })], {
      [FIGMA_QUERY]: strangers,
    });

    await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.companyList[0]).toMatchObject({ address: null, phone: null, website: null });
  });

  // Criterion 55 — the employer stays open, so a later run asks again.
  test("the employer is not marked done", async () => {
    const built = build([unscoredCompany({ id: "co-1", name: "Figma" })], {
      [FIGMA_QUERY]: strangers,
    });

    await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.companyList[0]?.enriched_at).toBeNull();
  });

  // Criterion 57.
  test("the run reports that the search found nothing", async () => {
    const built = build([unscoredCompany({ id: "co-1", name: "Figma" })], {
      [FIGMA_QUERY]: strangers,
    });

    const result = await enrichCompanies([{ company_id: "co-1" }], built);

    expect(result.companies[0]?.outcome).toBe("found_nothing");
  });
});

// Criterion 51. The service is paid per search.
describe("an employer already filled in", () => {
  test("the search service is not asked about it", async () => {
    const built = build([
      unscoredCompany({
        id: "co-1",
        name: "Figma",
        address: "760 Market Street, San Francisco, CA 94102",
        enriched_at: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ]);

    await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.search.asked).toEqual([]);
  });

  test("the run says it was already filled in", async () => {
    const built = build([
      unscoredCompany({ id: "co-1", name: "Figma", enriched_at: new Date("2026-01-01") }),
    ]);

    const result = await enrichCompanies([{ company_id: "co-1" }], built);

    expect(result.companies[0]?.outcome).toBe("already_filled");
  });

  test("what it already holds is left alone", async () => {
    const built = build([
      unscoredCompany({
        id: "co-1",
        name: "Figma",
        address: "760 Market Street, San Francisco, CA 94102",
        enriched_at: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ]);

    await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.companyList[0]?.address).toBe("760 Market Street, San Francisco, CA 94102");
  });
});

// Criterion 68. A query built from a blank name matches every result.
describe("an employer holding no name", () => {
  test("the search service is not asked about it", async () => {
    const built = build([unscoredCompany({ id: "co-blank" })]);

    await enrichCompanies([{ company_id: "co-blank" }], built);

    expect(built.search.asked).toEqual([]);
  });

  test("the run says it has no name", async () => {
    const built = build([unscoredCompany({ id: "co-blank" })]);

    const result = await enrichCompanies([{ company_id: "co-blank" }], built);

    expect(result.companies[0]?.outcome).toBe("no_name");
  });
});

// Criteria 52, 53, 54 and 66. There is no such thing as a permanently failed
// employer: every way a search can come back empty leaves it open.
describe("a search that could not answer", () => {
  test.each([
    ["no credential", new MissingSearchCredentialError("APIFY_API_TOKEN"), "no_credential"],
    ["a service error", new Error("the service is down"), "failed"],
    ["a run that was cut off", new Error("The search did not answer within its limit."), "failed"],
  ])("%s leaves the employer open", async (_name, thrown, outcome) => {
    const built = build([unscoredCompany({ id: "co-1", name: "Figma" })], {
      [FIGMA_QUERY]: thrown,
    });

    const result = await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.companyList[0]?.enriched_at).toBeNull();
    expect(result.companies[0]?.outcome).toBe(outcome);
  });

  // Criterion 54. An empty result set used to mark an employer done, which
  // was an accident nobody chose.
  test("a search returning no results at all leaves the employer open", async () => {
    const built = build([unscoredCompany({ id: "co-1", name: "Figma" })], { [FIGMA_QUERY]: [] });

    await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.companyList[0]?.enriched_at).toBeNull();
  });

  // Criterion 56.
  test("a missing credential is reported for that employer", async () => {
    const built = build([unscoredCompany({ id: "co-1", name: "Figma" })], {
      [FIGMA_QUERY]: new MissingSearchCredentialError("APIFY_API_TOKEN"),
    });

    const result = await enrichCompanies([{ company_id: "co-1" }], built);

    expect(result.warnings.join(" ")).toContain("Figma");
  });
});

// Criterion 67.
describe("a failure partway through a list", () => {
  test("the employers after it are still searched", async () => {
    const built = build(
      [
        unscoredCompany({ id: "co-1", name: "Broken Co" }),
        unscoredCompany({ id: "co-2", name: "Figma" }),
      ],
      {
        "Broken Co headquarters address, phone number, domain url": new Error("down"),
        [FIGMA_QUERY]: GOOD_RESULTS,
      }
    );

    await enrichCompanies([{ company_id: "co-1" }, { company_id: "co-2" }], built);

    expect(built.companyList[1]?.address).toBe("760 Market Street, San Francisco, CA 94102");
  });

  test("every employer in the list is reported", async () => {
    const built = build(
      [
        unscoredCompany({ id: "co-1", name: "Broken Co" }),
        unscoredCompany({ id: "co-2", name: "Figma" }),
      ],
      {
        "Broken Co headquarters address, phone number, domain url": new Error("down"),
        [FIGMA_QUERY]: GOOD_RESULTS,
      }
    );

    const result = await enrichCompanies([{ company_id: "co-1" }, { company_id: "co-2" }], built);

    expect(result.companies.map((company) => company.outcome)).toEqual(["failed", "filled"]);
  });
});

// Criteria 83 and 84.
describe("the query the search is asked", () => {
  test("it carries the place the job's location matched", async () => {
    const built = build([unscoredCompany({ id: "co-1", name: "Figma" })], {});

    await enrichCompanies([{ company_id: "co-1", place: "San Francisco, CA" }], built);

    expect(built.search.asked).toEqual([
      "Figma San Francisco, CA headquarters address, phone number, domain url",
    ]);
  });

  test("it holds the employer name alone where the job matched no place", async () => {
    const built = build([unscoredCompany({ id: "co-1", name: "Figma" })], {});

    await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.search.asked).toEqual([FIGMA_QUERY]);
  });
});

// Criteria 59, 60, 61 and 82, reaching the employer through this handler.
describe("the doubts the run records", () => {
  test("a search that filled everything in raises none", async () => {
    const built = build();

    const result = await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.companyList[0]?.enrichment_uncertain).toBe(false);
    expect(result.companies[0]?.doubts).toEqual([]);
  });

  test("a foreign address and a missing phone number are both recorded", async () => {
    const built = build([unscoredCompany({ id: "co-1", name: "Figma" })], {
      [FIGMA_QUERY]: [{ title: "Figma Inc.", text: "Website: www.figma.com" }],
    });

    await enrichCompanies([{ company_id: "co-1" }], built);

    expect(built.companyList[0]?.enrichment_uncertain).toBe(true);
    expect(built.companyList[0]?.enrichment_flags).toEqual(["missing_address", "missing_phone"]);
  });
});

// One employer standing behind two jobs in the same run is one search, not
// two, because the first one fills it in.
describe("the same employer named twice in one list", () => {
  test("the search service is asked once", async () => {
    const built = build();

    await enrichCompanies([{ company_id: "co-1" }, { company_id: "co-1" }], built);

    expect(built.search.asked).toEqual([FIGMA_QUERY]);
  });
});
