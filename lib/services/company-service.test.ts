import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Prisma } from "../../generated/pipeline/client";
import { createPipelineDb } from "../db/pipeline-db";
import { companyMatchKey } from "../utils/company-match-key";
import { createCompanyService, type CompanyService } from "./company-service";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..", "..");

// Creating the scratch database runs the prisma CLI in a child process, which
// is the slow part. A ceiling rather than a budget.
const CREATE_TIMEOUT_MS = 45_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

// Pushes the real schema onto a scratch database. The url travels in the
// environment because dotenv never overwrites a variable that is already set,
// so this value wins over the repo's .env and the real pipeline.db is never
// touched.
function createDb(prefix: string): { dir: string; url: string } {
  const temp = makeTempDb(prefix);
  execFileSync("npx", ["tsx", "scripts/db-create.ts"], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: temp.url },
    stdio: "pipe",
  });
  return temp;
}

// Points a real client at the scratch database. createPipelineDb reads the url
// at call time, so the environment only has to hold the scratch value for the
// moment of construction, and whatever was there before is put back.
function buildService(url: string): { db: PipelineDb; service: CompanyService } {
  const previous = process.env["PIPELINE_DATABASE_URL"];
  process.env["PIPELINE_DATABASE_URL"] = url;
  const db = createPipelineDb();
  if (previous === undefined) delete process.env["PIPELINE_DATABASE_URL"];
  else process.env["PIPELINE_DATABASE_URL"] = previous;
  return { db, service: createCompanyService(db) };
}

// Swaps a stand-in company delegate into a real client and leaves the rest of
// it alone, so a test can watch one table while everything else still reaches
// the scratch database.
function withCompany(real: PipelineDb, company: PipelineDb["company"]): PipelineDb {
  return new Proxy(real, {
    get(target, property) {
      if (property === "company") return company;
      return Reflect.get(target, property, target);
    },
  });
}

// Records the `where` of every company lookup the service runs. One lookup on
// the column a refusal named reads differently from three tried in turn, and
// the count is the only thing that tells them apart.
function recordingDb(real: PipelineDb, lookups: unknown[]): PipelineDb {
  const company = new Proxy(real.company, {
    get(target, property) {
      if (property !== "findUnique") return Reflect.get(target, property, target);
      // A proxy trap hands back a plain function, so the delegate's own
      // overloads are not available to type it.
      const findUnique = target.findUnique as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => {
        lookups.push((args[0] as { where?: unknown } | undefined)?.where);
        return findUnique(...args);
      };
    },
  });
  return withCompany(real, company);
}

// Hands back the refusal the database really produced with the column name
// taken off it, which is what a driver that stops carrying the name looks
// like from the service's side.
function columnlessRefusalDb(real: PipelineDb): PipelineDb {
  const company = new Proxy(real.company, {
    get(target, property) {
      if (property !== "create") return Reflect.get(target, property, target);
      const create = target.create as (...args: unknown[]) => Promise<unknown>;
      return async (...args: unknown[]) => {
        try {
          return await create(...args);
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) error.meta = undefined;
          throw error;
        }
      };
    },
  });
  return withCompany(real, company);
}

// One scratch database serves the whole file. Every test uses names and slugs
// of its own, so nothing collides and the prisma CLI runs once.
let dir: string;
let db: PipelineDb;
let service: CompanyService;

beforeAll(() => {
  const temp = createDb("pipeline-company-service-");
  dir = temp.dir;
  ({ db, service } = buildService(temp.url));
}, CREATE_TIMEOUT_MS);

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

// A slug is the stronger identity, so this is the lookup association tries
// first. A miss falls through to the name lookup rather than creating.
describe("finding a company by its board slug", () => {
  test("returns the company the slug row names", async () => {
    const company = await service.createNameless();
    await db.atsSlug.create({
      data: { slug: "find-by-slug-hit", company_id: company.id, parser: "greenhouse" },
    });

    const found = await service.findBySlug("find-by-slug-hit");

    expect(found?.id).toBe(company.id);
  });

  test("returns null where no company holds that slug", async () => {
    expect(await service.findBySlug("find-by-slug-nobody-holds")).toBeNull();
  });
});

// Two spellings of one employer share a match key, which is what makes the
// name lookup recognise them as one company.
describe("finding a company by its match key", () => {
  test("returns the company holding that key", async () => {
    await db.company.create({
      data: { name: "Key Lookup Co", match_key: companyMatchKey("Key Lookup Co") },
    });

    const found = await service.findByMatchKey("keylookup");

    expect(found?.name).toBe("Key Lookup Co");
  });

  // The point of the key. Two sources spelling one employer differently both
  // arrive at the row that already exists.
  test("a second spelling of that employer reaches the same company", async () => {
    await db.company.create({
      data: { name: "Second Spelling Ltd", match_key: companyMatchKey("Second Spelling Ltd") },
    });

    const found = await service.findByMatchKey(companyMatchKey("Second Spelling, Inc."));

    expect(found?.name).toBe("Second Spelling Ltd");
  });

  test("returns null where no company holds that key", async () => {
    expect(await service.findByMatchKey("nobodyholdsthiskey")).toBeNull();
  });
});

// AC 30. Creating writes the key alongside the name, so the next job spelling
// that employer differently still ends on this row.
describe("creating a company", () => {
  test("writes the name and the key built from it", async () => {
    const result = await service.create({ name: "Created By Name" });

    expect(result.created).toBe(true);
    expect(result.company.name).toBe("Created By Name");
    expect(result.company.match_key).toBe("createdbyname");
  });

  // The seed's case. A company met only as a board has no name, and the slug
  // row written beside it is what identifies it.
  test("a nameless company is created with nothing filled in", async () => {
    const company = await service.createNameless();

    expect(company.name).toBeNull();
    expect(company.match_key).toBeNull();
  });

  // Two of them occupy neither unique column, so the seed can create one per
  // board without the second being refused.
  test("two nameless companies are two different rows", async () => {
    const first = await service.createNameless();
    const second = await service.createNameless();

    expect(second.id).not.toBe(first.id);
  });

  // AC 4. A record identified by nothing could never be matched again, so this
  // is a caller bug rather than an ordinary outcome, and it throws.
  test("refuses a record carrying no name", async () => {
    await expect(service.create({})).rejects.toThrow(/name/i);
  });

  // An empty name is no name. The tidy strips a name like "-" to nothing, and
  // SQLite treats an empty string as an ordinary value in a unique index.
  test("refuses a record whose only name is empty", async () => {
    await expect(service.create({ name: "" })).rejects.toThrow(/name/i);
  });

  // The emptiness check reads the trimmed name, so the stored name is the
  // trimmed one too. A stored name is what the Web UI shows the user.
  test("stores the name without its surrounding whitespace", async () => {
    const result = await service.create({ name: "  Trimmed Name  " });

    expect(result.company.name).toBe("Trimmed Name");
  });
});

// AC 32. Reachable when two searches run at once: the lookup missed, then the
// write was refused. Recovery attaches the blocking company rather than
// letting the error escape and cost the rest of the job list.
describe("a create the database refuses", () => {
  test("attaches the company already holding that name", async () => {
    await service.create({ name: "Clashing Create" });

    const second = await service.create({ name: "Clashing Create" });

    expect(second.created).toBe(false);
    expect(second.company.name).toBe("Clashing Create");
  });

  test("attaches the company already holding that key", async () => {
    const first = await service.create({ name: "Keyclash Holdings" });

    // A different spelling of one employer keys to the same string, so the
    // name is free while the key is taken.
    const second = await service.create({ name: "Keyclash" });

    expect(second.created).toBe(false);
    expect(second.company.id).toBe(first.company.id);
  });

});

// AC 76 and 77. A refusal names the column that blocked the write, so recovery
// looks that one column up. Where it names none, every value the service tried
// to write is checked in turn instead.
describe("recovering from a refused write", () => {
  test("looks up only the column a refused create names", async () => {
    const first = await service.create({ name: "One Lookup Holdings" });
    const lookups: unknown[] = [];
    const watched = createCompanyService(recordingDb(db, lookups));

    // A second spelling keys to the same string, so the name is free and the
    // match key is the column that blocks the write.
    const second = await watched.create({ name: "One Lookup, Holdings." });

    expect(second.created).toBe(false);
    expect(second.company.id).toBe(first.company.id);
    expect(lookups).toEqual([{ match_key: companyMatchKey("One Lookup Holdings") }]);
  });


  test("looks up only the column a refused name fill names", async () => {
    const holder = await service.create({ name: "Fill One Lookup Group" });
    const target = await service.createNameless();
    const lookups: unknown[] = [];
    const watched = createCompanyService(recordingDb(db, lookups));

    const result = await watched.fillName(target.id, "Fill One Lookup, Group.");

    expect(result.filled).toBe(false);
    expect(result.heldBy?.id).toBe(holder.company.id);
    expect(lookups).toEqual([{ match_key: companyMatchKey("Fill One Lookup Group") }]);
  });

  test("tries each column in turn where the refusal names none", async () => {
    const first = await service.create({ name: "No Column Named Holdings" });
    const lookups: unknown[] = [];
    const blind = createCompanyService(columnlessRefusalDb(recordingDb(db, lookups)));

    const second = await blind.create({ name: "No Column Named, Holdings." });

    expect(second.created).toBe(false);
    expect(second.company.id).toBe(first.company.id);
    expect(lookups).toEqual([
      { name: "No Column Named, Holdings." },
      { match_key: companyMatchKey("No Column Named Holdings") },
    ]);
  });
});

// AC 33. A company met only as a board slug takes a name from the first job
// that supplies one, and its key is written with it.
describe("filling a company's empty name", () => {
  test("writes the name and its key", async () => {
    const created = await service.createNameless();

    const result = await service.fillName(created.id, "Fill Name Target");

    expect(result.filled).toBe(true);
    expect(result.company.name).toBe("Fill Name Target");
    expect(result.company.match_key).toBe("fillnametarget");
  });


  // AC 35 and 55. An ordinary event, not a crash: two spellings of one
  // employer, one already named. The name is not written, the company the job
  // matched is handed back unchanged, and the holder is named so the step can
  // warn about a merge only the user can make.
  test("refuses a name another company already holds, and names the holder", async () => {
    const holder = await service.create({ name: "Name Clash Holder" });
    const target = await service.createNameless();

    const result = await service.fillName(target.id, "Name Clash Holder");

    expect(result.filled).toBe(false);
    expect(result.company.id).toBe(target.id);
    expect(result.company.name).toBeNull();
    expect(result.heldBy?.id).toBe(holder.company.id);
  });
});

// An agent researches a company on four things and writes back a score, the
// reasoning behind it, and whether it had to guess. A company is picked up
// again whenever any category is empty, so the write has to leave the
// categories it was not given exactly as they were.
describe("saving a company's scores", () => {
  const SCORED_AT = new Date("2026-09-15T00:00:00.000Z");

  async function companyNamed(name: string): Promise<string> {
    const { company } = await service.create({ name });
    return company.id;
  }

  test("a researched category is written with its score", async () => {
    const id = await companyNamed("Scores Written Co");

    const company = await service.saveScores(
      id,
      { employee_satisfaction: { score: 4, rationale: "well reviewed", guessed: false } },
      SCORED_AT
    );

    expect(company.employee_satisfaction).toBe(4);
  });

  test("the reasoning behind a category is written in a field of its own", async () => {
    const id = await companyNamed("Rationale Written Co");

    const company = await service.saveScores(
      id,
      { work_life_balance: { score: 2, rationale: "long hours reported", guessed: false } },
      SCORED_AT
    );

    expect(company.work_life_balance_rationale).toBe("long hours reported");
  });

  // Only the categories a company is missing are researched, so the three it
  // already holds must survive a write covering the fourth.
  test("a category the write was not given keeps the value it had", async () => {
    const id = await companyNamed("Partial Rescore Co");
    await service.saveScores(
      id,
      {
        employee_satisfaction: { score: 5, rationale: "excellent", guessed: false },
        customer_satisfaction: { score: 3, rationale: "mixed", guessed: false },
      },
      SCORED_AT
    );

    const company = await service.saveScores(
      id,
      { political_alignment: { score: 1, rationale: "rolled back DEI", guessed: false } },
      SCORED_AT
    );

    expect(company.employee_satisfaction).toBe(5);
    expect(company.customer_satisfaction).toBe(3);
  });

  test("the reasoning behind a category the write was not given survives too", async () => {
    const id = await companyNamed("Partial Rationale Co");
    await service.saveScores(
      id,
      { employee_satisfaction: { score: 5, rationale: "excellent", guessed: false } },
      SCORED_AT
    );

    const company = await service.saveScores(
      id,
      { political_alignment: { score: 1, rationale: "rolled back DEI", guessed: false } },
      SCORED_AT
    );

    expect(company.employee_satisfaction_rationale).toBe("excellent");
  });

  test("the date the company was scored is written onto it", async () => {
    const id = await companyNamed("Scored Date Co");

    const company = await service.saveScores(
      id,
      { customer_satisfaction: { score: 3, rationale: "no ratings found", guessed: true } },
      SCORED_AT
    );

    expect(company.scored_at?.toISOString()).toBe(SCORED_AT.toISOString());
  });

  // The rubric awards a 3 when nothing public was found, which looks exactly
  // like a researched middling score. The guessed list is what tells them
  // apart, so cleanup can empty a guess sooner than a judgement.
  test("a guessed category is named in the guessed list", async () => {
    const id = await companyNamed("Guessed Named Co");

    const company = await service.saveScores(
      id,
      {
        employee_satisfaction: { score: 4, rationale: "well reviewed", guessed: false },
        customer_satisfaction: { score: 3, rationale: "nothing public", guessed: true },
      },
      SCORED_AT
    );

    expect(company.scores_guessed).toEqual(["customer_satisfaction"]);
  });

  test("a company with every category researched has an empty guessed list", async () => {
    const id = await companyNamed("Nothing Guessed Co");

    const company = await service.saveScores(
      id,
      {
        employee_satisfaction: { score: 4, rationale: "a", guessed: false },
        customer_satisfaction: { score: 4, rationale: "b", guessed: false },
        work_life_balance: { score: 4, rationale: "c", guessed: false },
        political_alignment: { score: 4, rationale: "d", guessed: false },
      },
      SCORED_AT
    );

    expect(company.scores_guessed).toEqual([]);
  });

  // A partial re-score must not drop a guess made about a category it is not
  // touching, or that guess would sit in the ranking as if it were research.
  test("a guess about a category this write did not touch stays on the list", async () => {
    const id = await companyNamed("Guess Survives Co");
    await service.saveScores(
      id,
      { customer_satisfaction: { score: 3, rationale: "nothing public", guessed: true } },
      SCORED_AT
    );

    const company = await service.saveScores(
      id,
      { employee_satisfaction: { score: 4, rationale: "well reviewed", guessed: false } },
      SCORED_AT
    );

    expect(company.scores_guessed).toEqual(["customer_satisfaction"]);
  });

  // The other half of the same rule: researching a category that used to be a
  // guess takes it off the list.
  test("a category researched this time comes off the guessed list", async () => {
    const id = await companyNamed("Guess Replaced Co");
    await service.saveScores(
      id,
      { customer_satisfaction: { score: 3, rationale: "nothing public", guessed: true } },
      SCORED_AT
    );

    const company = await service.saveScores(
      id,
      { customer_satisfaction: { score: 5, rationale: "strong ratings", guessed: false } },
      SCORED_AT
    );

    expect(company.scores_guessed).toEqual([]);
  });

  test("the stored row holds what was written", async () => {
    const id = await companyNamed("Stored Scores Co");
    await service.saveScores(
      id,
      { political_alignment: { score: 2, rationale: "conservative donations", guessed: false } },
      SCORED_AT
    );

    const stored = await db.company.findUnique({ where: { id } });
    expect(stored?.political_alignment).toBe(2);
  });
});

// Scoring researches every company holding a backlog job and missing a score,
// so a ranking is never built on blanks.
describe("finding the companies that still need a score", () => {
  const COLLECTED_AT = new Date("2026-09-01T00:00:00.000Z");
  const FULL_SCORES = {
    employee_satisfaction: 4,
    customer_satisfaction: 4,
    work_life_balance: 4,
    political_alignment: 4,
  };

  async function companyWithJob(
    name: string,
    scores: Record<string, number> = {},
    jobStatus = "backlog",
    jobCount = 1
  ): Promise<string> {
    const company = await db.company.create({ data: { name, match_key: name, ...scores } });
    for (let index = 0; index < jobCount; index += 1) {
      await db.job.create({
        data: {
          id: `${name}-job-${index}`,
          company_id: company.id,
          collected_at: COLLECTED_AT,
          status: jobStatus,
        },
      });
    }
    return company.id;
  }

  // Criterion 9.
  test("a company holding a backlog job and missing a score is on the list", async () => {
    const id = await companyWithJob("Needs Score Co");

    const companies = await service.findNeedingScores();

    expect(companies.map((company) => company.id)).toContain(id);
  });

  // One missing category is enough, because a ranking built on a blank is
  // not a ranking.
  test("a company missing only one of the four is on the list", async () => {
    const id = await companyWithJob("Missing One Co", {
      employee_satisfaction: 4,
      customer_satisfaction: 4,
      work_life_balance: 4,
    });

    const companies = await service.findNeedingScores();

    expect(companies.map((company) => company.id)).toContain(id);
  });

  // Criterion 10.
  test("a company holding all four scores is not on the list", async () => {
    const id = await companyWithJob("Fully Scored Co", FULL_SCORES);

    const companies = await service.findNeedingScores();

    expect(companies.map((company) => company.id)).not.toContain(id);
  });

  // Criterion 11. The user has already decided about a job that left the
  // backlog, so its employer is not worth researching.
  test("a company whose only jobs left the backlog is not on the list", async () => {
    const id = await companyWithJob("Applied Co", {}, "app. sent");

    const companies = await service.findNeedingScores();

    expect(companies.map((company) => company.id)).not.toContain(id);
  });

  test("a company holding no jobs at all is not on the list", async () => {
    const company = await db.company.create({
      data: { name: "Jobless Co", match_key: "joblessco" },
    });

    const companies = await service.findNeedingScores();

    expect(companies.map((each) => each.id)).not.toContain(company.id);
  });

  // Criterion 12. One helper researches one company, so a company appearing
  // twice would be researched twice and paid for twice.
  test("a company holding several backlog jobs appears once", async () => {
    const id = await companyWithJob("Several Jobs Co", {}, "backlog", 3);

    const companies = await service.findNeedingScores();

    expect(companies.filter((company) => company.id === id)).toHaveLength(1);
  });

  // The helper researches by name, so the list has to carry it.
  test("a company on the list carries its name", async () => {
    await companyWithJob("Named For Research Co");

    const companies = await service.findNeedingScores();
    const found = companies.find((company) => company.name === "Named For Research Co");

    expect(found).toBeDefined();
  });
});

// Criteria 33 and 51. A status change has a job's company id and nothing
// else, so it reads the employer here — to see whether it holds a usable
// name, and whether a search has already filled its contact details in.
describe("finding a company by its id", () => {
  test("gives back the company holding that id", async () => {
    const { company } = await service.create({ name: "Read By Id Co" });

    const found = await service.findById(company.id);

    expect(found?.id).toBe(company.id);
    expect(found?.name).toBe("Read By Id Co");
  });

  test("gives back nothing where no company holds that id", async () => {
    expect(await service.findById("no-such-company")).toBeNull();
  });

  // A board the app polls creates a company holding a slug and no name, so a
  // job attached to one of those carries an employer whose name is still
  // blank. The read has to show that.
  test("gives back a company holding no name", async () => {
    const nameless = await service.createNameless();

    const found = await service.findById(nameless.id);

    expect(found?.id).toBe(nameless.id);
    expect(found?.name).toBeNull();
  });

  // Criterion 51 is judged on these, so a read that left them off would send
  // every employer back to the paid search on every status change.
  test("carries the contact fields a search fills in", async () => {
    const { company } = await service.create({ name: "Contact Fields Co" });

    const found = await service.findById(company.id);

    expect(found).toMatchObject({
      address: null,
      phone: null,
      website: null,
      enriched_at: null,
      enrichment_status: null,
      enrichment_uncertain: false,
      enrichment_flags: [],
    });
  });
});

// Criterion 58. The mark goes down before the search starts, so a run cut
// short partway is told apart from one that was never tried.
describe("marking a company as being searched", () => {
  test("the company reads as being searched", async () => {
    const { company } = await service.create({ name: "Marked Co" });

    await service.startEnrichment(company.id);

    expect((await service.findById(company.id))?.enrichment_status).toBe("pending");
  });

  test("nothing is filled in by the mark alone", async () => {
    const { company } = await service.create({ name: "Marked Empty Co" });

    await service.startEnrichment(company.id);

    expect(await service.findById(company.id)).toMatchObject({
      address: null,
      phone: null,
      website: null,
      enriched_at: null,
    });
  });

  // The mark is not a record of success, so it must not make the company
  // look done. Only a search that filled a field in does that.
  test("the mark alone does not make the company done", async () => {
    const { company } = await service.create({ name: "Marked Not Done Co" });

    await service.startEnrichment(company.id);

    expect((await service.findById(company.id))?.enriched_at).toBeNull();
  });
});

// Criteria 45, 46, 47 and 59.
describe("saving what a search found", () => {
  const FOUND = {
    address: "760 Market Street, San Francisco, CA 94102",
    phone: "415-555-0142",
    website: "https://www.figma.com",
  };
  const AT = new Date("2026-02-01T00:00:00.000Z");

  test("the company holds the address, the phone number and the website", async () => {
    const { company } = await service.create({ name: "Found Co" });

    await service.saveEnrichment(company.id, FOUND, [], AT);

    expect(await service.findById(company.id)).toMatchObject(FOUND);
  });

  test("a search that filled something in marks the company done", async () => {
    const { company } = await service.create({ name: "Found Done Co" });

    await service.saveEnrichment(company.id, FOUND, [], AT);

    expect(await service.findById(company.id)).toMatchObject({
      enriched_at: AT,
      enrichment_status: "complete",
    });
  });

  test("a search that raised no doubt leaves the company undoubted", async () => {
    const { company } = await service.create({ name: "Found Certain Co" });

    await service.saveEnrichment(company.id, FOUND, [], AT);

    expect(await service.findById(company.id)).toMatchObject({
      enrichment_uncertain: false,
      enrichment_flags: [],
    });
  });

  test("the doubts a search raised are stored and mark the company doubtful", async () => {
    const { company } = await service.create({ name: "Found Doubtful Co" });

    await service.saveEnrichment(
      company.id,
      { address: "1 Hacker Way, London" },
      ["address_outside_us", "missing_phone"],
      AT
    );

    expect(await service.findById(company.id)).toMatchObject({
      enrichment_uncertain: true,
      enrichment_flags: ["address_outside_us", "missing_phone"],
    });
  });

  // The user's rule: there is no such thing as a permanently failed company.
  // A search that filled nothing in is recorded as having found nothing, and
  // the company stays open to a later search.
  test("a search that filled nothing in leaves the company not done", async () => {
    const { company } = await service.create({ name: "Found Nothing Co" });

    await service.saveEnrichment(company.id, {}, ["missing_address", "missing_phone"], AT);

    expect(await service.findById(company.id)).toMatchObject({
      enriched_at: null,
      enrichment_status: "failed",
    });
  });

  test("a website alone is enough to mark the company done", async () => {
    const { company } = await service.create({ name: "Found Website Only Co" });

    await service.saveEnrichment(company.id, { website: "https://example.com" }, [], AT);

    expect((await service.findById(company.id))?.enriched_at).toEqual(AT);
  });

  // A field the search did not fill is written empty rather than left
  // standing, because the search is the only thing that writes these and a
  // later run must not read a value this one did not find.
  test("a field the search did not fill reads as empty", async () => {
    const { company } = await service.create({ name: "Found Partial Co" });

    await service.saveEnrichment(company.id, { address: FOUND.address }, ["missing_phone"], AT);

    expect(await service.findById(company.id)).toMatchObject({
      address: FOUND.address,
      phone: null,
      website: null,
    });
  });
});
