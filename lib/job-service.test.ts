import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "./pipeline-db";
import { createJobService, type JobService } from "./job-service";
import type { JobListEntry } from "./job-list-entry";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..");

// Creating the scratch database runs the prisma CLI in a child process, which
// is the slow part. A ceiling rather than a budget.
const CREATE_TIMEOUT_MS = 45_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Greenhouse outranks adzuna, so a contested field these two both fill goes
// greenhouse's way whichever side it arrived on.
const PRIORITY_LIST = ["collector:greenhouse", "collector:adzuna"];

// A fixed date, so nothing in these tests depends on when they run.
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");

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
function buildService(url: string): { db: PipelineDb; service: JobService } {
  const previous = process.env["PIPELINE_DATABASE_URL"];
  process.env["PIPELINE_DATABASE_URL"] = url;
  const db = createPipelineDb();
  if (previous === undefined) delete process.env["PIPELINE_DATABASE_URL"];
  else process.env["PIPELINE_DATABASE_URL"] = previous;
  return { db, service: createJobService(db) };
}

// One scratch database serves the whole file. Every test uses ids of its own,
// so nothing collides and the prisma CLI runs once.
let dir: string;
let db: PipelineDb;
let service: JobService;

beforeAll(() => {
  const temp = createDb("pipeline-job-service-");
  dir = temp.dir;
  ({ db, service } = buildService(temp.url));
}, CREATE_TIMEOUT_MS);

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

// Puts a row straight into the table, bypassing the service, so a test can set
// up the state it wants to act on. collected_at is supplied because the column
// carries no database default.
async function seedRow(
  id: string,
  fields: Record<string, unknown> = {}
): Promise<void> {
  await db.job.create({
    data: { id, collected_at: COLLECTED_AT, ...fields },
  });
}

// Job.company_id is a real foreign key, so a row pointing at a company needs
// that company on file first.
async function seedCompany(id: string): Promise<void> {
  await db.company.create({ data: { id } });
}

// Hands back whatever a call threw. Prisma quotes the surrounding source
// lines inside its own error messages, so a guard's wording can appear in an
// error the service never raised — the tests below check the error's name as
// well, which is "Error" for the service's own and something Prisma-specific
// for one raised on the way past.
async function thrownBy(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to throw, but it resolved");
}

// AC 45. A job is given its id at collection so a dead end can name it, so the
// row has to take that id rather than minting one of its own.
describe("creating a row", () => {
  test("keeps the id the entry brought", async () => {
    const result = await service.update(
      { id: "create-keeps-id", collected_at: COLLECTED_AT, raw_title: "Product Designer" },
      PRIORITY_LIST
    );

    expect(result.outcome).toBe("created");
    const row = await db.job.findUnique({ where: { id: "create-keeps-id" } });
    expect(row?.raw_title).toBe("Product Designer");
  });

  // AC 44. No collector sets a status, so the schema's own default is what a
  // freshly collected job lands in.
  test("takes backlog where the entry carries no status", async () => {
    await service.update({ id: "create-default-status", collected_at: COLLECTED_AT }, PRIORITY_LIST);

    const row = await db.job.findUnique({ where: { id: "create-default-status" } });
    expect(row?.status).toBe("backlog");
  });

  test("refuses an entry carrying no id", async () => {
    const error = await thrownBy(service.update({ collected_at: COLLECTED_AT }, PRIORITY_LIST));

    expect(error.name).toBe("Error");
    expect(error.message).toMatch(/requires entry\.id/i);
  });

  // collected_at is required with no default, so a create missing it fails
  // deep inside Prisma unless the service says so plainly first.
  test("refuses to create a row with no collection date", async () => {
    const error = await thrownBy(service.update({ id: "create-no-date" }, PRIORITY_LIST));

    expect(error.name).toBe("Error");
    expect(error.message).toMatch(/without collected_at/i);
  });
});

// AC 46. Scoring hands over an id and a score and nothing else, so every other
// column has to survive the write untouched.
describe("updating a row", () => {
  test("changes only the field the entry named", async () => {
    await seedRow("update-one-field", { raw_title: "Kept Title", is_parsed: false });

    const result = await service.update({ id: "update-one-field", is_parsed: true }, PRIORITY_LIST);

    expect(result.outcome).toBe("updated");
    const row = await db.job.findUnique({ where: { id: "update-one-field" } });
    expect(row?.is_parsed).toBe(true);
    expect(row?.raw_title).toBe("Kept Title");
  });

  // The service runs the priority contest rather than leaving it to callers,
  // so the better-ranked source wins a field both sides filled.
  test("gives a contested field to the better-ranked source", async () => {
    await seedRow("update-contest", { collector: "adzuna", title: "Adzuna Title" });

    await service.update(
      { id: "update-contest", collector: "greenhouse", title: "Greenhouse Title" },
      PRIORITY_LIST
    );

    const row = await db.job.findUnique({ where: { id: "update-contest" } });
    expect(row?.title).toBe("Greenhouse Title");
    expect(row?.collector).toBe("greenhouse");
  });

  // AC 43. rejected is not an active status, so the row is freely updatable,
  // and a freshly collected entry carries no status to reset it with.
  test("leaves a rejected row's status alone where the entry carries none", async () => {
    await seedRow("update-rejected", { status: "rejected", raw_title: "Old" });

    await service.update(
      { id: "update-rejected", collector: "greenhouse", raw_title: "New" },
      PRIORITY_LIST
    );

    const row = await db.job.findUnique({ where: { id: "update-rejected" } });
    expect(row?.status).toBe("rejected");
    expect(row?.raw_title).toBe("New");
  });
});

// AC 47. Reachable when two saves run at once: the lookup missed, then the
// write was refused. The row that took the id is the row the caller wanted.
describe("a create the database refuses", () => {
  // Only the lookup lies. The create underneath is the real Prisma write, so
  // the refusal it hits is a genuine unique-constraint error.
  function racingService(): JobService {
    const blind = {
      job: {
        findUnique: async () => null,
        create: (args: unknown) => db.job.create(args as never),
        update: (args: unknown) => db.job.update(args as never),
        delete: (args: unknown) => db.job.delete(args as never),
      },
    } as unknown as PipelineDb;
    return createJobService(blind);
  }

  test("updates the row that took the id instead of failing", async () => {
    await seedRow("racing-create", { raw_title: "Already Here" });

    const result = await racingService().update(
      { id: "racing-create", collected_at: COLLECTED_AT, description: "arrived second" },
      PRIORITY_LIST
    );

    expect(result.outcome).toBe("updated");
    const row = await db.job.findUnique({ where: { id: "racing-create" } });
    expect(row?.description).toBe("arrived second");
    expect(row?.raw_title).toBe("Already Here");
  });
});

// AC 49 and 50. The user is acting on an active job, so nothing a later
// collection reports about it changes what they do next.
describe("a row the user has applied to", () => {
  test("takes a new status and nothing else", async () => {
    await seedRow("active-status-change", { status: "interview", raw_title: "Old Title" });

    const result = await service.update(
      { id: "active-status-change", status: "offer", raw_title: "New Title" },
      PRIORITY_LIST
    );

    expect(result.outcome).toBe("status_updated");
    const row = await db.job.findUnique({ where: { id: "active-status-change" } });
    expect(row?.status).toBe("offer");
    expect(row?.raw_title).toBe("Old Title");
  });

  test("is left untouched where the entry carries no status", async () => {
    await seedRow("active-no-status", { status: "screening", raw_title: "Frozen Title" });

    const result = await service.update(
      { id: "active-no-status", raw_title: "Ignored Title" },
      PRIORITY_LIST
    );

    expect(result.outcome).toBe("unchanged");
    const row = await db.job.findUnique({ where: { id: "active-no-status" } });
    expect(row?.status).toBe("screening");
    expect(row?.raw_title).toBe("Frozen Title");
  });
});

// AC 51, 51a and 52. Deleting is how dedupe's merges land, and the guard is
// what stops one destroying an application the user is in the middle of.
describe("deleting a row", () => {
  test("removes a row in a non-active status", async () => {
    await seedRow("delete-plain", { status: "backlog" });

    const result = await service.delete("delete-plain");

    expect(result.deleted).toBe(true);
    expect(result.blockedBy).toBeNull();
    expect(await db.job.findUnique({ where: { id: "delete-plain" } })).toBeNull();
  });

  test("writes nothing where no row holds that id", async () => {
    const result = await service.delete("delete-nobody-holds");

    expect(result.deleted).toBe(false);
    expect(result.blockedBy).toBeNull();
    expect(await db.job.findUnique({ where: { id: "delete-nobody-holds" } })).toBeNull();
  });

  test("refuses a row the user has applied to and hands it back", async () => {
    await seedRow("delete-active", { status: "app. sent", raw_title: "Applied Job" });

    const result = await service.delete("delete-active");

    expect(result.deleted).toBe(false);
    expect(result.blockedBy?.id).toBe("delete-active");
    expect(result.blockedBy?.raw_title).toBe("Applied Job");
    expect(await db.job.findUnique({ where: { id: "delete-active" } })).not.toBeNull();
  });
});

// Every write to Job shapes its data through toColumnData, which builds each
// link's match key from the link standing beside it. Dedupe looks jobs up by
// those keys, so a link and its key must never drift apart.
describe("stamping the link match keys", () => {
  // AC 15.
  test("a created row's original_url_match_key holds that link's key", async () => {
    await service.update(
      {
        id: "keys-create-original",
        collected_at: COLLECTED_AT,
        original_url: "https://www.adzuna.com/land/ad/5872600391?se=8lLTgnii8BroTBApR2iJSA",
      },
      PRIORITY_LIST
    );

    const row = await db.job.findUnique({ where: { id: "keys-create-original" } });
    expect(row?.original_url_match_key).toBe("https://www.adzuna.com/land/ad/5872600391");
  });

  // AC 16.
  test("a created row's resolved_url_match_key holds that link's key", async () => {
    await service.update(
      {
        id: "keys-create-resolved",
        collected_at: COLLECTED_AT,
        resolved_url: "https://boards.greenhouse.io/acme/jobs/456?gh_src=abc",
      },
      PRIORITY_LIST
    );

    const row = await db.job.findUnique({ where: { id: "keys-create-resolved" } });
    expect(row?.resolved_url_match_key).toBe("https://boards.greenhouse.io/acme/jobs/456");
  });

  // AC 17. Resolution fills resolved_url long after the row was created, so
  // the update path has to stamp the key the create path never could.
  test("an update writing resolved_url for the first time stamps its key", async () => {
    await seedRow("keys-update-resolved", { collector: "greenhouse" });

    await service.update(
      {
        id: "keys-update-resolved",
        resolved_url: "https://jobs.lever.co/acme/9f2c1b?lever-source=x",
      },
      PRIORITY_LIST
    );

    const row = await db.job.findUnique({ where: { id: "keys-update-resolved" } });
    expect(row?.resolved_url_match_key).toBe("https://jobs.lever.co/acme/9f2c1b");
  });

  // AC 18. greenhouse outranks adzuna, so the arriving link wins the contest
  // and the stored key has to move with it.
  test("an update changing original_url through a merge stamps the new link's key", async () => {
    await seedRow("keys-update-original", {
      collector: "adzuna",
      original_url: "https://www.adzuna.com/land/ad/111?se=old",
      original_url_match_key: "https://www.adzuna.com/land/ad/111",
    });

    await service.update(
      {
        id: "keys-update-original",
        collector: "greenhouse",
        original_url: "https://boards.greenhouse.io/acme/jobs/999",
      },
      PRIORITY_LIST
    );

    const row = await db.job.findUnique({ where: { id: "keys-update-original" } });
    expect(row?.original_url).toBe("https://boards.greenhouse.io/acme/jobs/999");
    expect(row?.original_url_match_key).toBe("https://boards.greenhouse.io/acme/jobs/999");
  });

  // AC 18 the other way round. There the arriving link won; here the held one
  // does, and its key has to stay put. The merge picks the winner before the
  // key is computed, so stamping from the arriving link would leave the
  // winning link sitting beside the losing link's key — a row dedupe would
  // then match on a link it does not hold.
  test("a losing link does not stamp its key over the winning link's", async () => {
    await seedRow("keys-update-losing", {
      collector: "greenhouse",
      original_url: "https://boards.greenhouse.io/acme/jobs/999",
      original_url_match_key: "https://boards.greenhouse.io/acme/jobs/999",
    });

    await service.update(
      {
        id: "keys-update-losing",
        collector: "adzuna",
        original_url: "https://www.adzuna.com/land/ad/111?se=x",
      },
      PRIORITY_LIST
    );

    const row = await db.job.findUnique({ where: { id: "keys-update-losing" } });
    expect(row?.original_url).toBe("https://boards.greenhouse.io/acme/jobs/999");
    expect(row?.original_url_match_key).toBe("https://boards.greenhouse.io/acme/jobs/999");
  });

  // AC 19. An active row is frozen except for its status, so the entry's own
  // link never reaches the write and neither key moves.
  test("a status-only write to an active row leaves both keys unchanged", async () => {
    await seedRow("keys-active", {
      status: "app. sent",
      original_url: "https://example.com/jobs/1",
      original_url_match_key: "https://example.com/jobs/1",
      resolved_url: "https://example.com/jobs/1/apply",
      resolved_url_match_key: "https://example.com/jobs/1/apply",
    });

    await service.update(
      {
        id: "keys-active",
        status: "interview",
        original_url: "https://elsewhere.com/somewhere-else",
      },
      PRIORITY_LIST
    );

    const row = await db.job.findUnique({ where: { id: "keys-active" } });
    expect(row?.status).toBe("interview");
    expect(row?.original_url_match_key).toBe("https://example.com/jobs/1");
    expect(row?.resolved_url_match_key).toBe("https://example.com/jobs/1/apply");
  });

  // AC 20.
  test("a created row carrying no links has both keys empty", async () => {
    await service.update({ id: "keys-create-none", collected_at: COLLECTED_AT }, PRIORITY_LIST);

    const row = await db.job.findUnique({ where: { id: "keys-create-none" } });
    expect(row?.original_url_match_key).toBeNull();
    expect(row?.resolved_url_match_key).toBeNull();
  });

  // AC 49. A merged job carries the surviving id's created_at while it travels
  // in memory. toColumnData strips it, so the database's own birthday stands.
  test("an entry carrying a created_at never writes it to the row", async () => {
    const stale = new Date("2020-01-01T00:00:00.000Z");

    await service.update(
      { id: "keys-created-at", collected_at: COLLECTED_AT, created_at: stale },
      PRIORITY_LIST
    );

    const row = await db.job.findUnique({ where: { id: "keys-created-at" } });
    expect(row?.created_at.getTime()).not.toBe(stale.getTime());
  });
});

// The three lookups dedupe's database compare runs against a surviving entry.
// Each one asks a different question of the table, so all three run every
// time and any of them can name a row the others did not. The step reaches no
// database of its own, so they live here on the service that owns Job.
describe("the dedupe lookups", () => {
  test("finds every row holding an original-url match key", async () => {
    await seedRow("lookup-orig-a", { original_url_match_key: "https://example.com/jobs/7" });
    await seedRow("lookup-orig-b", { original_url_match_key: "https://example.com/jobs/7" });
    await seedRow("lookup-orig-c", { original_url_match_key: "https://example.com/jobs/8" });

    const found = await service.findByOriginalUrlMatchKey("https://example.com/jobs/7");

    expect(found.map((job) => job.id).sort()).toEqual(["lookup-orig-a", "lookup-orig-b"]);
  });

  test("finds nothing where no row holds the original-url key", async () => {
    const found = await service.findByOriginalUrlMatchKey("https://example.com/nobody-here");

    expect(found).toEqual([]);
  });

  test("finds every row holding a resolved-url match key", async () => {
    await seedRow("lookup-res-a", { resolved_url_match_key: "https://boards.example.com/9" });
    await seedRow("lookup-res-b", { resolved_url_match_key: "https://boards.example.com/10" });

    const found = await service.findByResolvedUrlMatchKey("https://boards.example.com/9");

    expect(found.map((job) => job.id)).toEqual(["lookup-res-a"]);
  });

  test("finds every row sharing a company and a title", async () => {
    await seedCompany("company-77");
    await seedRow("lookup-ct-a", { company_id: "company-77", title: "Senior Product Designer" });
    await seedRow("lookup-ct-b", { company_id: "company-77", title: "Senior Product Designer" });

    const found = await service.findByCompanyAndTitle("company-77", "Senior Product Designer");

    expect(found.map((job) => job.id).sort()).toEqual(["lookup-ct-a", "lookup-ct-b"]);
  });

  test("ignores a row matching the company but not the title", async () => {
    await seedCompany("company-78");
    await seedRow("lookup-ct-c", { company_id: "company-78", title: "Product Designer" });
    await seedRow("lookup-ct-d", { company_id: "company-78", title: "Design Engineer" });

    const found = await service.findByCompanyAndTitle("company-78", "Product Designer");

    expect(found.map((job) => job.id)).toEqual(["lookup-ct-c"]);
  });
});

// AC 1 to 4. Resolution pulls its own job list out of the table rather than
// being handed one by the step before it, so the read that builds that list
// lives here on the service that owns Job.
describe("the resolution job list", () => {
  // One scratch database serves this whole file, so rows seeded by other
  // tests sit in the same table. Each test here reads back only the ids it
  // seeded itself.
  function onlyMine(jobs: JobListEntry[], prefix: string): JobListEntry[] {
    return jobs.filter((job) => (job.id ?? "").startsWith(prefix));
  }

  test("holds only backlog jobs that are not yet resolved", async () => {
    await seedRow("list-filter-waiting");
    await seedRow("list-filter-resolved", { is_resolved: true });
    await seedRow("list-filter-markUnresolvable", { status: "unresolvable" });

    const found = onlyMine(await service.findUnresolved(), "list-filter-");

    expect(found.map((job) => job.id)).toEqual(["list-filter-waiting"]);
  });

  // AC 2. Nothing narrows the list to one run. A job collected weeks ago and
  // never resolved is still waiting for the walk.
  test("holds a job collected during an earlier run", async () => {
    await seedRow("list-earlier-run", { collected_at: new Date("2025-06-01T00:00:00.000Z") });

    const found = onlyMine(await service.findUnresolved(), "list-earlier-run");

    expect(found.map((job) => job.id)).toEqual(["list-earlier-run"]);
  });

  // AC 3. The four gate fields are left behind, so an entry carried on to
  // dedupe and save holds no stale copy of a flag another phase owns.
  test("leaves the four gate fields behind", async () => {
    await seedRow("list-fields-absent");

    const [entry] = onlyMine(await service.findUnresolved(), "list-fields-absent");

    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_resolved");
    expect(entry).not.toHaveProperty("is_parsed");
    expect(entry).not.toHaveProperty("is_classified");
  });

  // AC 4. The walk needs the id to write back and the collector to know
  // whether a blacklisted job may be dropped, and dedupe reads created_at as
  // the sign that an entry already holds a database row.
  test("carries the id, the collector and the created_at", async () => {
    await seedRow("list-fields-present", { collector: "adzuna" });

    const [entry] = onlyMine(await service.findUnresolved(), "list-fields-present");

    expect(entry?.id).toBe("list-fields-present");
    expect(entry?.collector).toBe("adzuna");
    expect(entry?.created_at).toBeInstanceOf(Date);
  });
});
