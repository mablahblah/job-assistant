import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "../db/pipeline-db";
import { createAtsSlugService, type AtsSlugService } from "./ats-slug-service";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..", "..");

// Creating the scratch database runs the prisma CLI in a child process, which
// is the slow part. A ceiling rather than a budget.
// Raised from 45 seconds, which a full-suite run exceeded: vitest runs
// these child processes in parallel and they contend for the machine.
const CREATE_TIMEOUT_MS = 120_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

// Pushes the real schema onto a scratch database. The url travels as the
// argument the create command requires, and also in the environment so the
// clients built afterwards reach the same file.
function createDb(prefix: string): { dir: string; url: string } {
  const temp = makeTempDb(prefix);
  execFileSync("npx", ["tsx", "scripts/db-create.ts", temp.url], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: temp.url },
    stdio: "pipe",
  });
  return temp;
}

// Points a real client at the scratch database. createPipelineDb reads the url
// at call time, so the environment only has to hold the scratch value for the
// moment of construction, and whatever was there before is put back.
function buildService(url: string): { db: PipelineDb; service: AtsSlugService } {
  const previous = process.env["PIPELINE_DATABASE_URL"];
  process.env["PIPELINE_DATABASE_URL"] = url;
  const db = createPipelineDb();
  if (previous === undefined) delete process.env["PIPELINE_DATABASE_URL"];
  else process.env["PIPELINE_DATABASE_URL"] = previous;
  return { db, service: createAtsSlugService(db) };
}

// One scratch database serves the whole file. Every test uses slugs of its
// own, so nothing collides and the prisma CLI runs once.
let dir: string;
let db: PipelineDb;
let service: AtsSlugService;

beforeAll(() => {
  const temp = createDb("pipeline-ats-slug-service-");
  dir = temp.dir;
  ({ db, service } = buildService(temp.url));
}, CREATE_TIMEOUT_MS);

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

// A row has to name a company, so each test makes its own.
async function makeCompany(name: string): Promise<string> {
  const company = await db.company.create({ data: { name, match_key: name } });
  return company.id;
}

// Company matching writes the row as soon as a posting is read. It knows the
// slug, the company and the parser that read the posting, and nothing yet
// about whether we want to poll that board.
describe("writing the row for a slug met on a posting", () => {
  test("the row holds the slug", async () => {
    const companyId = await makeCompany("Record Holds Slug");
    const { row } = await service.record({
      slug: "record-holds-slug",
      company_id: companyId,
      parser: "greenhouse",
    });
    expect(row.slug).toBe("record-holds-slug");
  });

  test("the row names the company", async () => {
    const companyId = await makeCompany("Record Names Company");
    const { row } = await service.record({
      slug: "record-names-company",
      company_id: companyId,
      parser: "greenhouse",
    });
    expect(row.company_id).toBe(companyId);
  });

  test("the row names the parser that read the posting", async () => {
    const companyId = await makeCompany("Record Names Parser");
    const { row } = await service.record({
      slug: "record-names-parser",
      company_id: companyId,
      parser: "lever",
    });
    expect(row.parser).toBe("lever");
  });

  // Knowing that a company posts on a hiring system is a separate fact from
  // choosing to poll its board, and only promotion decides the second.
  test("the row carries no collector", async () => {
    const companyId = await makeCompany("Record Has No Collector");
    const { row } = await service.record({
      slug: "record-has-no-collector",
      company_id: companyId,
      parser: "ashby",
    });
    expect(row.collector).toBeNull();
  });

  test("a row that was written says so", async () => {
    const companyId = await makeCompany("Record Reports Created");
    const result = await service.record({
      slug: "record-reports-created",
      company_id: companyId,
      parser: "greenhouse",
    });
    expect(result.created).toBe(true);
  });
});

// Two postings from one board reach the same slug, and the second must not
// write a row of its own: a slug held by two rows could not be resolved to
// one company.
describe("a slug another row already holds", () => {
  test("no second row is written", async () => {
    const first = await makeCompany("Slug Held First");
    const second = await makeCompany("Slug Held Second");
    await service.record({ slug: "slug-held", company_id: first, parser: "greenhouse" });
    await service.record({ slug: "slug-held", company_id: second, parser: "lever" });

    const rows = await db.atsSlug.findMany({ where: { slug: "slug-held" } });
    expect(rows.length).toBe(1);
  });

  test("the row that was already there is handed back", async () => {
    const first = await makeCompany("Slug Kept First");
    const second = await makeCompany("Slug Kept Second");
    await service.record({ slug: "slug-kept", company_id: first, parser: "greenhouse" });
    const { row } = await service.record({
      slug: "slug-kept",
      company_id: second,
      parser: "lever",
    });

    expect(row.company_id).toBe(first);
  });

  test("the second write says it created nothing", async () => {
    const first = await makeCompany("Slug Reported First");
    const second = await makeCompany("Slug Reported Second");
    await service.record({ slug: "slug-reported", company_id: first, parser: "greenhouse" });
    const result = await service.record({
      slug: "slug-reported",
      company_id: second,
      parser: "lever",
    });

    expect(result.created).toBe(false);
  });
});

// Company matching looks a slug up here rather than on the company record.
describe("finding the row holding a slug", () => {
  test("the row holding that slug comes back", async () => {
    const companyId = await makeCompany("Find By Slug Hit");
    await service.record({ slug: "find-by-slug-hit", company_id: companyId, parser: "greenhouse" });

    const row = await service.findBySlug("find-by-slug-hit");
    expect(row?.company_id).toBe(companyId);
  });

  test("a slug no row holds comes back empty", async () => {
    expect(await service.findBySlug("find-by-slug-miss")).toBeNull();
  });
});

// Promotion is the only thing that fills a collector in, and filling it in is
// what puts the board on that collector's polling list.
describe("putting a board on a collector's polling list", () => {
  test("the row takes the collector", async () => {
    const companyId = await makeCompany("Add Collector");
    await service.record({ slug: "add-collector", company_id: companyId, parser: "greenhouse" });

    const row = await service.addCollector("add-collector", "greenhouse");
    expect(row?.collector).toBe("greenhouse");
  });

  test("the stored row holds the collector afterwards", async () => {
    const companyId = await makeCompany("Add Collector Stored");
    await service.record({
      slug: "add-collector-stored",
      company_id: companyId,
      parser: "greenhouse",
    });
    await service.addCollector("add-collector-stored", "greenhouse");

    const stored = await db.atsSlug.findUnique({ where: { slug: "add-collector-stored" } });
    expect(stored?.collector).toBe("greenhouse");
  });

  // A company whose scores are cleared is researched again and can beat the
  // threshold a second time, so promoting an already-promoted board happens.
  test("a row already carrying a collector raises no error", async () => {
    const companyId = await makeCompany("Add Collector Twice");
    await service.record({
      slug: "add-collector-twice",
      company_id: companyId,
      parser: "greenhouse",
    });
    await service.addCollector("add-collector-twice", "greenhouse");

    await expect(service.addCollector("add-collector-twice", "lever")).resolves.toBeDefined();
  });

  test("a row already carrying a collector is left as it is", async () => {
    const companyId = await makeCompany("Add Collector Unchanged");
    await service.record({
      slug: "add-collector-unchanged",
      company_id: companyId,
      parser: "greenhouse",
    });
    await service.addCollector("add-collector-unchanged", "greenhouse");
    await service.addCollector("add-collector-unchanged", "lever");

    const stored = await db.atsSlug.findUnique({ where: { slug: "add-collector-unchanged" } });
    expect(stored?.collector).toBe("greenhouse");
  });

  test("a slug no row holds comes back empty", async () => {
    expect(await service.addCollector("add-collector-missing", "greenhouse")).toBeNull();
  });
});

// This is the lookup the three ATS collectors run to find their boards. It
// used to be a query over the company table through the settings service.
describe("listing the boards one collector polls", () => {
  test("a board carrying that collector is on the list", async () => {
    const companyId = await makeCompany("List Polled");
    await service.record({ slug: "list-polled", company_id: companyId, parser: "greenhouse" });
    await service.addCollector("list-polled", "list-collector");

    const boards = await service.listForCollector("list-collector");
    expect(boards.map((board) => board.slug)).toContain("list-polled");
  });

  test("a board carrying no collector is not on the list", async () => {
    const companyId = await makeCompany("List Unpolled");
    await service.record({ slug: "list-unpolled", company_id: companyId, parser: "greenhouse" });

    const boards = await service.listForCollector("list-collector");
    expect(boards.map((board) => board.slug)).not.toContain("list-unpolled");
  });

  test("a board carrying a different collector is not on the list", async () => {
    const companyId = await makeCompany("List Other Collector");
    await service.record({
      slug: "list-other-collector",
      company_id: companyId,
      parser: "lever",
    });
    await service.addCollector("list-other-collector", "other-collector");

    const boards = await service.listForCollector("list-collector");
    expect(boards.map((board) => board.slug)).not.toContain("list-other-collector");
  });

  // Emptying a collector's list is how that collector gets switched off, so
  // no board is a real answer rather than a broken database.
  test("a collector polling nothing gets an empty list", async () => {
    expect(await service.listForCollector("collector-with-no-boards")).toEqual([]);
  });
});

// Promotion needs every board one employer posts on, so it can hand each row
// the collector matching the parser that found it.
describe("listing the boards one company posts on", () => {
  test("every row naming that company is on the list", async () => {
    const companyId = await makeCompany("List By Company");
    await service.record({ slug: "by-company-one", company_id: companyId, parser: "greenhouse" });
    await service.record({ slug: "by-company-two", company_id: companyId, parser: "lever" });

    const boards = await service.listForCompany(companyId);
    expect(boards.map((board) => board.slug).sort()).toEqual(["by-company-one", "by-company-two"]);
  });

  test("a row naming another company is not on the list", async () => {
    const mine = await makeCompany("List Mine");
    const theirs = await makeCompany("List Theirs");
    await service.record({ slug: "by-company-theirs", company_id: theirs, parser: "ashby" });

    expect(await service.listForCompany(mine)).toEqual([]);
  });
});

// A paid search leaves out every company the app already polls, whichever
// collector polls it, and it leaves them out by name.
describe("listing every polled board with its company's name", () => {
  test("a board each collector polls is on the list, with its company's name", async () => {
    const first = await makeCompany("Polled By First");
    const second = await makeCompany("Polled By Second");
    await service.record({ slug: "polled-first", company_id: first, parser: "greenhouse" });
    await service.record({ slug: "polled-second", company_id: second, parser: "lever" });
    await service.addCollector("polled-first", "first-collector");
    await service.addCollector("polled-second", "second-collector");

    const boards = await service.listPolled();
    const named = boards.map((board) => ({ slug: board.slug, company_name: board.company_name }));
    expect(named).toContainEqual({ slug: "polled-first", company_name: "Polled By First" });
    expect(named).toContainEqual({ slug: "polled-second", company_name: "Polled By Second" });
  });

  test("a board no collector polls is not on the list", async () => {
    const companyId = await makeCompany("Polled Nobody");
    await service.record({ slug: "polled-nobody", company_id: companyId, parser: "greenhouse" });

    const boards = await service.listPolled();
    expect(boards.map((board) => board.slug)).not.toContain("polled-nobody");
  });

  // A company met only as a board slug has no name, and nothing invents one,
  // so the reader is told there is none rather than handed a made-up name.
  test("a polled board whose company has no name comes back with no name", async () => {
    const nameless = await db.company.create({ data: {} });
    await service.record({ slug: "polled-nameless", company_id: nameless.id, parser: "ashby" });
    await service.addCollector("polled-nameless", "first-collector");

    const boards = await service.listPolled();
    const board = boards.find((row) => row.slug === "polled-nameless");
    expect(board?.company_name).toBeNull();
  });
});

// Nothing in this phase takes a board off a polling list, and the company
// sweep that would have needed one left for the backlog. Offering the
// function anyway would invite a caller this phase never designed for.
describe("the service offers no way to remove a row", () => {
  test("no method removes or deletes", () => {
    const names = Object.keys(service);
    for (const name of names) {
      expect(name.toLowerCase()).not.toContain("remove");
      expect(name.toLowerCase()).not.toContain("delete");
    }
  });
});
