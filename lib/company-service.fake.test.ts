import { describe, expect, test } from "vitest";
import { companyMatchKey } from "./company-match-key";
import type { CompanyRecord } from "./company-service";
import { fakeCompanyService } from "./company-service.fake";

// The fake stands in for the real service in the association step's tests, so
// it has to reach the same answers the real one does. These checks mirror
// lib/company-service.test.ts: where the two files disagree, the fake is
// lying and every test that trusts it is worthless.

function slugCompany(id: string, slug: string): CompanyRecord {
  return { id, name: null, match_key: null, ats_platform: "ashby", ats_slug: slug };
}

function namedCompany(id: string, name: string): CompanyRecord {
  return {
    id,
    name,
    match_key: companyMatchKey(name),
    ats_platform: null,
    ats_slug: null,
  };
}

describe("looking a company up", () => {
  test("finds a seeded company by its slug", async () => {
    const service = fakeCompanyService([slugCompany("c1", "hinge-health")]);

    expect((await service.findBySlug("hinge-health"))?.id).toBe("c1");
  });

  test("returns null for a slug nobody holds", async () => {
    const service = fakeCompanyService([slugCompany("c1", "hinge-health")]);

    expect(await service.findBySlug("nobody-holds-this")).toBeNull();
  });

  test("finds a seeded company by its match key", async () => {
    const service = fakeCompanyService([namedCompany("c1", "Key Lookup Co")]);

    expect((await service.findByMatchKey("keylookup"))?.id).toBe("c1");
  });

  test("returns null for a key nobody holds", async () => {
    const service = fakeCompanyService([namedCompany("c1", "Key Lookup Co")]);

    expect(await service.findByMatchKey("nobodyholdsthiskey")).toBeNull();
  });
});

describe("creating a company", () => {
  test("adds it to the list the caller handed in", async () => {
    const companies: CompanyRecord[] = [];
    const service = fakeCompanyService(companies);

    const result = await service.create({ name: "Created By Name" });

    expect(result.created).toBe(true);
    expect(companies).toHaveLength(1);
    expect(companies[0]?.name).toBe("Created By Name");
  });

  // The same rule the real service follows, so a name written here matches a
  // name written there.
  test("builds the match key from the name", async () => {
    const service = fakeCompanyService();

    const result = await service.create({ name: "Created By Name" });

    expect(result.company.match_key).toBe("createdbyname");
  });

  test("gives a slug-only company no name and no key", async () => {
    const service = fakeCompanyService();

    const result = await service.create({ ats_platform: "ashby", ats_slug: "created-by-slug" });

    expect(result.company.name).toBeNull();
    expect(result.company.match_key).toBeNull();
    expect(result.company.ats_slug).toBe("created-by-slug");
  });

  test("gives every company an id of its own", async () => {
    const service = fakeCompanyService();

    const first = await service.create({ name: "First Company" });
    const second = await service.create({ name: "Second Company" });

    expect(first.company.id).not.toBe(second.company.id);
  });

  test("refuses a record carrying neither a name nor a slug", async () => {
    const service = fakeCompanyService();

    await expect(service.create({})).rejects.toThrow(/name|slug/i);
  });

  test("refuses a record whose only name is empty", async () => {
    const service = fakeCompanyService();

    await expect(service.create({ name: "   " })).rejects.toThrow(/name|slug/i);
  });

  test("stores the name without its surrounding whitespace", async () => {
    const service = fakeCompanyService();

    const result = await service.create({ name: "  Trimmed Name  " });

    expect(result.company.name).toBe("Trimmed Name");
  });
});

// Criterion 31: two jobs in one list naming the same absent employer produce
// one company that both jobs carry. That only works if the fake remembers
// what the first call created, which is why it holds state at all.
describe("a create the fake refuses", () => {
  test("hands back the company already holding that name", async () => {
    const companies: CompanyRecord[] = [];
    const service = fakeCompanyService(companies);

    const first = await service.create({ name: "Clashing Create" });
    const second = await service.create({ name: "Clashing Create" });

    expect(second.created).toBe(false);
    expect(second.company.id).toBe(first.company.id);
    expect(companies).toHaveLength(1);
  });

  test("hands back the company already holding that key", async () => {
    const service = fakeCompanyService();

    const first = await service.create({ name: "Keyclash Holdings" });
    const second = await service.create({ name: "Keyclash" });

    expect(second.created).toBe(false);
    expect(second.company.id).toBe(first.company.id);
  });

  test("hands back the company already holding that slug", async () => {
    const service = fakeCompanyService();

    const first = await service.create({ ats_platform: "ashby", ats_slug: "clashing-slug" });
    const second = await service.create({ ats_platform: "ashby", ats_slug: "clashing-slug" });

    expect(second.created).toBe(false);
    expect(second.company.id).toBe(first.company.id);
  });
});

describe("filling a company's empty name", () => {
  test("writes the name and its key", async () => {
    const companies = [slugCompany("c1", "fill-name-target")];
    const service = fakeCompanyService(companies);

    const result = await service.fillName("c1", "Fill Name Target");

    expect(result.filled).toBe(true);
    expect(result.company.name).toBe("Fill Name Target");
    expect(result.company.match_key).toBe("fillnametarget");
    expect(companies[0]?.name).toBe("Fill Name Target");
  });

  test("leaves the platform and slug untouched", async () => {
    const service = fakeCompanyService([slugCompany("c1", "fill-keeps-slug")]);

    const result = await service.fillName("c1", "Fill Keeps Slug");

    expect(result.company.ats_platform).toBe("ashby");
    expect(result.company.ats_slug).toBe("fill-keeps-slug");
  });

  test("refuses a name another company already holds, and names the holder", async () => {
    const service = fakeCompanyService([
      namedCompany("holder", "Name Clash Holder"),
      slugCompany("target", "name-clash-target"),
    ]);

    const result = await service.fillName("target", "Name Clash Holder");

    expect(result.filled).toBe(false);
    expect(result.company.id).toBe("target");
    expect(result.company.name).toBeNull();
    expect(result.heldBy?.id).toBe("holder");
  });
});

// The overrides argument is the reason this is a fake rather than a second
// implementation: a test that needs one odd answer replaces one method and
// leaves the rest behaving normally.
describe("overrides", () => {
  test("a replaced method wins over the fake's own", async () => {
    const service = fakeCompanyService([], {
      findBySlug: async () => namedCompany("overridden", "Overridden"),
    });

    expect((await service.findBySlug("anything"))?.id).toBe("overridden");
  });

  test("the methods left alone still behave", async () => {
    const service = fakeCompanyService([], {
      findBySlug: async () => null,
    });

    const result = await service.create({ name: "Still Works" });

    expect(result.created).toBe(true);
    expect(result.company.match_key).toBe("stillworks");
  });
});
