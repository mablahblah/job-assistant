import { describe, expect, test } from "vitest";
import type { AtsSlugRecord } from "./ats-slug-service";
import { fakeAtsSlugService } from "./ats-slug-service.fake";

// The fake stands in for the real service wherever a handler is tested
// without a database, so it has to reach the same answers the real one does.
// These checks mirror lib/services/ats-slug-service.test.ts: where the two
// files disagree, the fake is lying and every test that trusts it is
// worthless.

function board(slug: string, companyId: string, collector: string | null = null): AtsSlugRecord {
  return { id: `row-${slug}`, slug, company_id: companyId, parser: "greenhouse", collector };
}

describe("writing the row for a slug met on a posting", () => {
  test("the row holds what it was given", async () => {
    const service = fakeAtsSlugService();

    const { row } = await service.record({
      slug: "acme",
      company_id: "c1",
      parser: "lever",
    });

    expect(row.slug).toBe("acme");
    expect(row.company_id).toBe("c1");
    expect(row.parser).toBe("lever");
  });

  test("the row carries no collector", async () => {
    const service = fakeAtsSlugService();

    const { row } = await service.record({ slug: "acme", company_id: "c1", parser: "lever" });

    expect(row.collector).toBeNull();
  });

  test("a row that was written says so", async () => {
    const service = fakeAtsSlugService();

    const result = await service.record({ slug: "acme", company_id: "c1", parser: "lever" });

    expect(result.created).toBe(true);
  });

  // The caller's own array is what the fake writes into, so a test can seed
  // rows and read back what the code under test did.
  test("the written row lands in the caller's list", async () => {
    const rows: AtsSlugRecord[] = [];
    const service = fakeAtsSlugService(rows);

    await service.record({ slug: "acme", company_id: "c1", parser: "lever" });

    expect(rows.map((each) => each.slug)).toEqual(["acme"]);
  });
});

describe("a slug another row already holds", () => {
  test("no second row is written", async () => {
    const rows = [board("acme", "c1")];
    const service = fakeAtsSlugService(rows);

    await service.record({ slug: "acme", company_id: "c2", parser: "lever" });

    expect(rows.length).toBe(1);
  });

  test("the row that was already there is handed back", async () => {
    const service = fakeAtsSlugService([board("acme", "c1")]);

    const { row } = await service.record({ slug: "acme", company_id: "c2", parser: "lever" });

    expect(row.company_id).toBe("c1");
  });

  test("the second write says it created nothing", async () => {
    const service = fakeAtsSlugService([board("acme", "c1")]);

    const result = await service.record({ slug: "acme", company_id: "c2", parser: "lever" });

    expect(result.created).toBe(false);
  });
});

describe("finding the row holding a slug", () => {
  test("finds a seeded row by its slug", async () => {
    const service = fakeAtsSlugService([board("acme", "c1")]);

    expect((await service.findBySlug("acme"))?.company_id).toBe("c1");
  });

  test("returns null for a slug nobody holds", async () => {
    const service = fakeAtsSlugService([board("acme", "c1")]);

    expect(await service.findBySlug("nobody-holds-this")).toBeNull();
  });
});

describe("putting a board on a collector's polling list", () => {
  test("the row takes the collector", async () => {
    const service = fakeAtsSlugService([board("acme", "c1")]);

    expect((await service.addCollector("acme", "greenhouse"))?.collector).toBe("greenhouse");
  });

  test("the seeded row holds the collector afterwards", async () => {
    const rows = [board("acme", "c1")];
    const service = fakeAtsSlugService(rows);

    await service.addCollector("acme", "greenhouse");

    expect(rows[0]?.collector).toBe("greenhouse");
  });

  test("a row already carrying a collector is left as it is", async () => {
    const rows = [board("acme", "c1", "greenhouse")];
    const service = fakeAtsSlugService(rows);

    await service.addCollector("acme", "lever");

    expect(rows[0]?.collector).toBe("greenhouse");
  });

  test("a slug no row holds comes back empty", async () => {
    const service = fakeAtsSlugService();

    expect(await service.addCollector("nobody-holds-this", "greenhouse")).toBeNull();
  });
});

describe("listing the boards one collector polls", () => {
  test("a board carrying that collector is on the list", async () => {
    const service = fakeAtsSlugService([board("acme", "c1", "greenhouse")]);

    const boards = await service.listForCollector("greenhouse");

    expect(boards.map((each) => each.slug)).toEqual(["acme"]);
  });

  test("a board carrying no collector is not on the list", async () => {
    const service = fakeAtsSlugService([board("acme", "c1")]);

    expect(await service.listForCollector("greenhouse")).toEqual([]);
  });

  test("a board carrying a different collector is not on the list", async () => {
    const service = fakeAtsSlugService([board("acme", "c1", "lever")]);

    expect(await service.listForCollector("greenhouse")).toEqual([]);
  });
});

// A test that needs one method to behave differently passes it in rather than
// building a second fake, the same way the company fake allows.
describe("a caller can override one method", () => {
  test("the override answers instead of the fake's own method", async () => {
    const service = fakeAtsSlugService([], {
      listForCollector: async () => [board("overridden", "c1", "greenhouse")],
    });

    const boards = await service.listForCollector("greenhouse");

    expect(boards.map((each) => each.slug)).toEqual(["overridden"]);
  });
});

// The fake answers the company lookup the same way the real service does, so
// a promotion test can read a company's boards back without a database.
describe("the fake lists the boards one company posts on", () => {
  test("every row naming that company comes back", async () => {
    const rows: AtsSlugRecord[] = [];
    const service = fakeAtsSlugService(rows);
    await service.record({ slug: "fake-one", company_id: "c1", parser: "greenhouse" });
    await service.record({ slug: "fake-two", company_id: "c1", parser: "lever" });
    await service.record({ slug: "fake-three", company_id: "c2", parser: "ashby" });

    const boards = await service.listForCompany("c1");
    expect(boards.map((board) => board.slug)).toEqual(["fake-one", "fake-two"]);
  });

  test("a company with no board gets an empty list", async () => {
    const service = fakeAtsSlugService([]);
    expect(await service.listForCompany("nobody")).toEqual([]);
  });
});

// Mirrors the real service's read of every polled board. The fake holds no
// company table, so a test hands it the company names, keyed by company id.
describe("the fake lists every polled board with its company's name", () => {
  test("a board each collector polls is on the list, with its company's name", async () => {
    const service = fakeAtsSlugService(
      [board("polled-first", "c1", "greenhouse"), board("polled-second", "c2", "lever")],
      {},
      { c1: "Polled By First", c2: "Polled By Second" }
    );

    const boards = await service.listPolled();
    const named = boards.map((each) => ({ slug: each.slug, company_name: each.company_name }));
    expect(named).toEqual([
      { slug: "polled-first", company_name: "Polled By First" },
      { slug: "polled-second", company_name: "Polled By Second" },
    ]);
  });

  test("a board no collector polls is not on the list", async () => {
    const service = fakeAtsSlugService([board("polled-nobody", "c1")], {}, { c1: "Polled Nobody" });

    expect(await service.listPolled()).toEqual([]);
  });

  test("a polled board whose company has no name comes back with no name", async () => {
    const service = fakeAtsSlugService([board("polled-nameless", "c1", "greenhouse")]);

    const boards = await service.listPolled();
    expect(boards.map((each) => each.company_name)).toEqual([null]);
  });
});
