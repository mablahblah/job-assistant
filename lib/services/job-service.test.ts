import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "../db/pipeline-db";
import { createJobService, type JobService } from "./job-service";
import type { JobListEntry } from "../types/job-list-entry";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..", "..");

// Creating the scratch database runs the prisma CLI in a child process, which
// is the slow part. A ceiling rather than a budget.
// Raised from 45 seconds, which a full-suite run exceeded: vitest runs
// these child processes in parallel and they contend for the machine.
const CREATE_TIMEOUT_MS = 120_000;

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
async function seedCompany(id: string, name?: string): Promise<void> {
  await db.company.create({ data: { id, ...(name === undefined ? {} : { name }) } });
}

// Hands back whatever a call threw. Prisma quotes the surrounding source
// lines inside its own error messages, so a guardrail's wording can appear in an
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

  // AC 9. Every job carries an age, so a job reaching save with no posting date
  // anywhere takes its collection date as its posting date. The rule was built
  // into the pooler and the merge calls it, but a first-ever save never merges,
  // so this is the path that proves the rule reaches the row.
  test("takes its collection date as posting date where the entry carries none", async () => {
    await service.update({ id: "create-no-dates", collected_at: COLLECTED_AT }, PRIORITY_LIST);

    const row = await db.job.findUnique({ where: { id: "create-no-dates" } });
    expect(row?.posting_date).toEqual(COLLECTED_AT);
    expect(row?.posting_updated_date).toBeNull();
  });

  // The other half of the same rule: the fallback fires only where no date
  // exists, so a date the source did publish is never replaced by it.
  test("keeps a posting date the entry brought", async () => {
    const published = new Date("2025-12-01T00:00:00.000Z");
    await service.update(
      { id: "create-with-date", collected_at: COLLECTED_AT, posting_date: published },
      PRIORITY_LIST
    );

    const row = await db.job.findUnique({ where: { id: "create-with-date" } });
    expect(row?.posting_date).toEqual(published);
    expect(row?.posting_updated_date).toBeNull();
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

// AC 51, 51a and 52. Deleting is how dedupe's merges land, and the guardrail is
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
describe("writing the link match keys", () => {
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
  // the update path has to write the key the create path never could.
  test("an update writing resolved_url for the first time writes its key", async () => {
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
  test("an update changing original_url through a merge writes the new link's key", async () => {
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
  // key is computed, so writing from the arriving link would leave the
  // winning link sitting beside the losing link's key — a row dedupe would
  // then match on a link it does not hold.
  test("a losing link does not write its key over the winning link's", async () => {
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
  // never resolved is still waiting for resolution.
  test("holds a job collected during an earlier run", async () => {
    await seedRow("list-earlier-run", { collected_at: new Date("2025-06-01T00:00:00.000Z") });

    const found = onlyMine(await service.findUnresolved(), "list-earlier-run");

    expect(found.map((job) => job.id)).toEqual(["list-earlier-run"]);
  });

  // AC 3. The five gate fields are left behind, so an entry carried on to
  // dedupe and save holds no stale copy of a flag another phase owns.
  test("leaves the five gate fields behind", async () => {
    await seedRow("list-fields-absent");

    const [entry] = onlyMine(await service.findUnresolved(), "list-fields-absent");

    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_resolved");
    expect(entry).not.toHaveProperty("is_parsed");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });

  // AC 4. Resolution needs the id to write back and the collector to know
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

// AC 24 to 27. Parsing pulls its own job list out of the table the way
// resolution does, because the database is the only handoff between steps.
describe("the parsing job list", () => {
  // One scratch database serves this whole file, so rows seeded by other
  // tests sit in the same table. Each test here reads back only the ids it
  // seeded itself.
  function onlyMine(jobs: JobListEntry[], prefix: string): JobListEntry[] {
    return jobs.filter((job) => (job.id ?? "").startsWith(prefix));
  }

  test("holds only backlog jobs that are resolved and not yet parsed", async () => {
    await seedRow("parse-list-waiting", { is_resolved: true });
    await seedRow("parse-list-unresolved");
    await seedRow("parse-list-parsed", { is_resolved: true, is_parsed: true });
    await seedRow("parse-list-unparseable", { is_resolved: true, status: "unparseable" });

    const found = onlyMine(await service.findUnparsed(), "parse-list-");

    expect(found.map((job) => job.id)).toEqual(["parse-list-waiting"]);
  });

  test("holds a job that kept backlog after failing to parse on an earlier run", async () => {
    await seedRow("parse-retry", {
      is_resolved: true,
      is_parsed: false,
      collected_at: new Date("2025-06-01T00:00:00.000Z"),
    });

    const found = onlyMine(await service.findUnparsed(), "parse-retry");

    expect(found.map((job) => job.id)).toEqual(["parse-retry"]);
  });

  test("leaves the five gate fields behind", async () => {
    await seedRow("parse-fields-absent", { is_resolved: true });

    const [entry] = onlyMine(await service.findUnparsed(), "parse-fields-absent");

    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_resolved");
    expect(entry).not.toHaveProperty("is_parsed");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });

  test("carries the id, the resolved link and the collector a parse needs", async () => {
    await seedRow("parse-fields-present", {
      is_resolved: true,
      collector: "adzuna",
      resolved_url: "https://boards.greenhouse.io/acme/jobs/1",
    });

    const [entry] = onlyMine(await service.findUnparsed(), "parse-fields-present");

    expect(entry?.id).toBe("parse-fields-present");
    expect(entry?.collector).toBe("adzuna");
    expect(entry?.resolved_url).toBe("https://boards.greenhouse.io/acme/jobs/1");
  });
});

// The run's own date, so an age never depends on when the suite happens to
// run. Thirty days before COLLECTED_AT, so a job seeded with no posting date
// reads as thirty days old.
const RUN_DATE = new Date("2026-01-31T00:00:00.000Z");

describe("the backlog cleanup job list", () => {
  function onlyMine(jobs: JobListEntry[], prefix: string): JobListEntry[] {
    return jobs.filter((job) => (job.id ?? "").startsWith(prefix));
  }

  // Criterion 10. Backlog cleanup sweeps the backlog and nothing else.
  test("holds every backlog job, whatever else it has been through", async () => {
    await seedRow("sweep-plain");
    await seedRow("sweep-resolved", { is_resolved: true });
    await seedRow("sweep-judged", { is_resolved: true, is_parsed: true, is_classified: true });
    await seedRow("sweep-expired", { status: "expired" });
    await seedRow("sweep-too-far", { status: "too far" });

    const found = onlyMine(await service.findBacklog(), "sweep-");

    expect(found.map((job) => job.id).sort()).toEqual([
      "sweep-judged",
      "sweep-plain",
      "sweep-resolved",
    ]);
  });

  test("leaves the five gate fields behind", async () => {
    await seedRow("sweep-fields");
    const [entry] = onlyMine(await service.findBacklog(), "sweep-fields");
    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });

  // Backlog cleanup judges age, so the dates have to come across.
  test("carries the dates an age is measured from", async () => {
    await seedRow("sweep-dates", { posting_date: new Date("2025-12-01T00:00:00.000Z") });
    const [entry] = onlyMine(await service.findBacklog(), "sweep-dates");
    expect(entry?.posting_date).toEqual(new Date("2025-12-01T00:00:00.000Z"));
    expect(entry?.collected_at).toEqual(COLLECTED_AT);
  });
});

describe("the promotion job list", () => {
  function onlyMine(jobs: JobListEntry[], prefix: string): JobListEntry[] {
    return jobs.filter((job) => (job.id ?? "").startsWith(prefix));
  }

  // Criterion 108.
  test("holds only jobs whose status is expired", async () => {
    await seedRow("promote-expired", {
      status: "expired",
      posting_date: new Date("2026-01-30T00:00:00.000Z"),
    });
    await seedRow("promote-backlog", { posting_date: new Date("2026-01-30T00:00:00.000Z") });
    await seedRow("promote-too-far", {
      status: "too far",
      posting_date: new Date("2026-01-30T00:00:00.000Z"),
    });

    const found = onlyMine(await service.findExpiredWithin(8, RUN_DATE), "promote-");

    expect(found.map((job) => job.id)).toEqual(["promote-expired"]);
  });

  // Criterion 17 and 121. A job backlog cleanup expired moments ago is past
  // the threshold, so promotion never sees it.
  test("leaves out an expired job still past the threshold", async () => {
    await seedRow("promote-old", {
      status: "expired",
      posting_date: new Date("2025-06-01T00:00:00.000Z"),
    });
    const found = onlyMine(await service.findExpiredWithin(8, RUN_DATE), "promote-old");
    expect(found).toEqual([]);
  });

  // Criterion 3. The date the source last changed the posting is what the age
  // is measured from, which is how a re-listed job comes back.
  test("an updated date brings a long-posted job back inside the threshold", async () => {
    await seedRow("promote-relisted", {
      status: "expired",
      posting_date: new Date("2025-06-01T00:00:00.000Z"),
      posting_updated_date: new Date("2026-01-30T00:00:00.000Z"),
    });
    const found = onlyMine(await service.findExpiredWithin(8, RUN_DATE), "promote-relisted");
    expect(found.map((job) => job.id)).toEqual(["promote-relisted"]);
  });

  // Criterion 6. The threshold is a setting, so the list moves with it.
  test("a wider threshold takes in more jobs", async () => {
    await seedRow("promote-threshold", {
      status: "expired",
      posting_date: new Date("2026-01-20T00:00:00.000Z"),
    });
    expect(onlyMine(await service.findExpiredWithin(8, RUN_DATE), "promote-threshold")).toEqual([]);
    const wider = onlyMine(await service.findExpiredWithin(30, RUN_DATE), "promote-threshold");
    expect(wider.map((job) => job.id)).toEqual(["promote-threshold"]);
  });

  test("leaves the five gate fields behind", async () => {
    await seedRow("promote-fields", {
      status: "expired",
      posting_date: new Date("2026-01-30T00:00:00.000Z"),
    });
    const [entry] = onlyMine(await service.findExpiredWithin(8, RUN_DATE), "promote-fields");
    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });
});

describe("the classification job list", () => {
  function onlyMine(jobs: JobListEntry[], prefix: string): JobListEntry[] {
    return jobs.filter((job) => (job.id ?? "").startsWith(prefix));
  }

  const READY = { is_resolved: true, is_parsed: true };

  // Criteria 18 and 19.
  test("holds only backlog jobs that are resolved, parsed and not yet judged", async () => {
    await seedRow("judge-ready", READY);
    await seedRow("judge-unresolved", { is_parsed: true });
    await seedRow("judge-unparsed", { is_resolved: true });
    await seedRow("judge-done", { ...READY, is_classified: true });
    await seedRow("judge-expired", { ...READY, status: "expired" });

    const found = onlyMine(await service.findUnclassified(), "judge-");

    expect(found.map((job) => job.id)).toEqual(["judge-ready"]);
  });

  test("leaves the five gate fields behind", async () => {
    await seedRow("judge-fields", READY);
    const [entry] = onlyMine(await service.findUnclassified(), "judge-fields");
    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });

  // Criterion 51. The places were cut out during normalization, so
  // classification reads them off the row rather than cutting them again.
  test("carries the place list and the mode list the match needs", async () => {
    await seedRow("judge-lists", {
      ...READY,
      normalized_location_list: ["Austin", "Travis County"],
      normalized_mode_list: ["remote"],
    });
    const [entry] = onlyMine(await service.findUnclassified(), "judge-lists");
    expect(entry?.normalized_location_list).toEqual(["Austin", "Travis County"]);
    expect(entry?.normalized_mode_list).toEqual(["remote"]);
  });

  // Classification judges age and reposts, so both dates have to come across.
  test("carries both posting dates", async () => {
    await seedRow("judge-dates", {
      ...READY,
      posting_date: new Date("2025-12-01T00:00:00.000Z"),
      posting_updated_date: new Date("2026-01-30T00:00:00.000Z"),
    });
    const [entry] = onlyMine(await service.findUnclassified(), "judge-dates");
    expect(entry?.posting_date).toEqual(new Date("2025-12-01T00:00:00.000Z"));
    expect(entry?.posting_updated_date).toEqual(new Date("2026-01-30T00:00:00.000Z"));
  });
});

// Scoring asks the database for its own work rather than reading what the
// pipeline returned, so a job an earlier run left unscored is picked up
// rather than lost.
describe("finding the jobs that still need an alignment score", () => {
  const COLLECTED_AT = new Date("2026-09-01T00:00:00.000Z");

  async function makeJob(id: string, overrides: Record<string, unknown> = {}): Promise<void> {
    await db.job.create({
      data: {
        id,
        collected_at: COLLECTED_AT,
        status: "backlog",
        is_resolved: true,
        is_parsed: true,
        is_classified: true,
        ...overrides,
      },
    });
  }

  // Scoring hands its entries on to a save, so the list carries no stale copy
  // of a flag another phase owns, the judged marker scoring itself sets
  // included.
  test("leaves the five gate fields behind", async () => {
    await makeJob("scoring-fields-absent");

    const [entry] = (await service.findNeedingScores()).filter(
      (job) => job.id === "scoring-fields-absent"
    );

    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("status");
    expect(entry).not.toHaveProperty("is_resolved");
    expect(entry).not.toHaveProperty("is_parsed");
    expect(entry).not.toHaveProperty("is_classified");
    expect(entry).not.toHaveProperty("is_judged");
  });

  // Criterion 3.
  test("a backlog job carrying no alignment score is on the list", async () => {
    await makeJob("needs-scoring");

    const jobs = await service.findNeedingScores();

    expect(jobs.map((job) => job.id)).toContain("needs-scoring");
  });

  // Criterion 4.
  test("a job already carrying an alignment score is not on the list", async () => {
    await makeJob("already-scored", { alignment_score: 4 });

    const jobs = await service.findNeedingScores();

    expect(jobs.map((job) => job.id)).not.toContain("already-scored");
  });

  // Criterion 5.
  test("a job that has not been resolved is not on the list", async () => {
    await makeJob("unresolved-job", { is_resolved: false });

    const jobs = await service.findNeedingScores();

    expect(jobs.map((job) => job.id)).not.toContain("unresolved-job");
  });

  // Criterion 6.
  test("a job that has not been parsed is not on the list", async () => {
    await makeJob("unparsed-job", { is_parsed: false });

    const jobs = await service.findNeedingScores();

    expect(jobs.map((job) => job.id)).not.toContain("unparsed-job");
  });

  // Criterion 7.
  test("a job that has not been classified is not on the list", async () => {
    await makeJob("unclassified-job", { is_classified: false });

    const jobs = await service.findNeedingScores();

    expect(jobs.map((job) => job.id)).not.toContain("unclassified-job");
  });

  // Only a backlog job is worth scoring: the user has already decided about
  // every other status.
  test("a job that has left the backlog is not on the list", async () => {
    await makeJob("applied-job", { status: "app. sent" });

    const jobs = await service.findNeedingScores();

    expect(jobs.map((job) => job.id)).not.toContain("applied-job");
  });

  // Criterion 8. The whole point of asking the database rather than reading a
  // list handed down.
  test("a job an earlier run left unscored is on a later run's list", async () => {
    await makeJob("left-unscored");

    const first = await service.findNeedingScores();
    const second = await service.findNeedingScores();

    expect(first.map((job) => job.id)).toContain("left-unscored");
    expect(second.map((job) => job.id)).toContain("left-unscored");
  });

  // The helper that scores a job reads the posting's own words, so the list
  // has to carry them.
  test("a job on the list carries the posting's own words", async () => {
    await makeJob("carries-description", { description: "We are hiring a designer." });

    const jobs = await service.findNeedingScores();
    const found = jobs.find((job) => job.id === "carries-description");

    expect(found?.description).toBe("We are hiring a designer.");
  });
});

// Criteria 7 and 8. Nothing could look a job up without also writing to it,
// and the write path creates a row when it cannot find one. A status change
// carries no collection date, so that create then refuses — which reports a
// missing column where the real answer is that the id matches no job. The
// command reads the job first and answers for itself.
describe("reading one job by its id", () => {
  test("gives back the row holding that id", async () => {
    await seedRow("read-one-a", { title: "Senior Product Designer" });

    const found = await service.findById("read-one-a");

    expect(found?.id).toBe("read-one-a");
    expect(found?.title).toBe("Senior Product Designer");
  });

  test("gives back nothing where no row holds that id", async () => {
    expect(await service.findById("read-one-nobody")).toBeNull();
  });

  // The read must not be a write in disguise. A mistyped id reaching a path
  // that creates a row would file a work log entry against a job nobody has.
  test("creates no row for an id that matches nothing", async () => {
    await service.findById("read-one-ghost");

    expect(await service.findById("read-one-ghost")).toBeNull();
  });
});

// AC 86, 87, 88, 89, 91, 101. The user names a job by its employer and roughly
// its role, never by an id, so this read is what turns those words into a row
// the change-status skill can act on.
describe("searching by part of an employer's name", () => {
  test("gives back every job whose employer name holds that part", async () => {
    await seedCompany("search-co-indeed", "Indeed");
    await seedRow("search-indeed-a", {
      company_id: "search-co-indeed",
      title: "Product Designer",
      posting_date: new Date("2026-01-01T00:00:00.000Z"),
    });
    await seedRow("search-indeed-b", {
      company_id: "search-co-indeed",
      title: "Senior Product Designer",
      posting_date: new Date("2026-02-01T00:00:00.000Z"),
    });

    const found = await service.findByCompanyNameMatch({ companyNamePart: "ndee" });

    expect(found.map((job) => job.id).sort()).toEqual(["search-indeed-a", "search-indeed-b"]);
  });

  test("names the job's employer, title and status on every match", async () => {
    await seedCompany("search-co-stripe", "Stripe");
    await seedRow("search-stripe-a", {
      company_id: "search-co-stripe",
      title: "Staff Product Designer",
      status: "app. sent",
      posting_date: new Date("2026-03-01T00:00:00.000Z"),
    });

    const [match] = await service.findByCompanyNameMatch({ companyNamePart: "Stripe" });

    expect(match).toMatchObject({
      id: "search-stripe-a",
      title: "Staff Product Designer",
      company_name: "Stripe",
      status: "app. sent",
    });
  });

  test("ignores letter casing in the part it is handed", async () => {
    await seedCompany("search-co-figma", "Figma");
    await seedRow("search-figma-a", {
      company_id: "search-co-figma",
      title: "Product Designer",
      posting_date: new Date("2026-01-05T00:00:00.000Z"),
    });

    const found = await service.findByCompanyNameMatch({ companyNamePart: "FIGMA" });

    expect(found.map((job) => job.id)).toEqual(["search-figma-a"]);
  });

  test("keeps only the jobs whose title holds the title part", async () => {
    await seedCompany("search-co-canva", "Canva");
    await seedRow("search-canva-designer", {
      company_id: "search-co-canva",
      title: "Product Designer",
      posting_date: new Date("2026-01-06T00:00:00.000Z"),
    });
    await seedRow("search-canva-engineer", {
      company_id: "search-co-canva",
      title: "Product Engineer",
      posting_date: new Date("2026-01-07T00:00:00.000Z"),
    });

    const found = await service.findByCompanyNameMatch({
      companyNamePart: "Canva",
      titlePart: "designer",
    });

    expect(found.map((job) => job.id)).toEqual(["search-canva-designer"]);
  });

  test("keeps only the jobs holding one of the statuses it was handed", async () => {
    await seedCompany("search-co-notion", "Notion");
    await seedRow("search-notion-backlog", {
      company_id: "search-co-notion",
      title: "Product Designer",
      status: "backlog",
      posting_date: new Date("2026-01-08T00:00:00.000Z"),
    });
    await seedRow("search-notion-sent", {
      company_id: "search-co-notion",
      title: "Product Designer",
      status: "app. sent",
      posting_date: new Date("2026-01-09T00:00:00.000Z"),
    });

    const found = await service.findByCompanyNameMatch({
      companyNamePart: "Notion",
      statuses: ["backlog"],
    });

    expect(found.map((job) => job.id)).toEqual(["search-notion-backlog"]);
  });

  test("puts the most recently published job first", async () => {
    await seedCompany("search-co-linear", "Linear");
    await seedRow("search-linear-older", {
      company_id: "search-co-linear",
      title: "Product Designer",
      posting_date: new Date("2026-01-10T00:00:00.000Z"),
    });
    await seedRow("search-linear-newer", {
      company_id: "search-co-linear",
      title: "Product Designer",
      posting_date: new Date("2026-04-10T00:00:00.000Z"),
    });

    const found = await service.findByCompanyNameMatch({ companyNamePart: "Linear" });

    expect(found.map((job) => job.id)).toEqual(["search-linear-newer", "search-linear-older"]);
  });

  test("gives back nothing where no employer name holds that part", async () => {
    expect(await service.findByCompanyNameMatch({ companyNamePart: "nobody-by-that-name" })).toEqual(
      []
    );
  });
});

// Criteria 113, 136, 138 and 175. The dashboard asks the service that owns the
// table rather than the database, and it needs the employer beside every job:
// four of the five ratings behind a total live on the employer, and the total
// is worked out as the page is built.
describe("reading the jobs a page list covers", () => {
  test("gives back only the jobs holding one of the statuses asked for", async () => {
    await seedRow("page-status-backlog", { status: "backlog" });
    await seedRow("page-status-sent", { status: "app. sent" });
    await seedRow("page-status-expired", { status: "expired" });

    const found = await service.findByStatuses(["backlog"]);

    expect(found.map((row) => row.job.id)).toContain("page-status-backlog");
    expect(found.map((row) => row.job.id)).not.toContain("page-status-sent");
    expect(found.map((row) => row.job.id)).not.toContain("page-status-expired");
  });

  test("covers every status it was handed", async () => {
    await seedRow("page-status-many-a", { status: "unresolvable" });
    await seedRow("page-status-many-b", { status: "unparseable" });

    const found = await service.findByStatuses(["unresolvable", "unparseable"]);
    const ids = found.map((row) => row.job.id);

    expect(ids).toContain("page-status-many-a");
    expect(ids).toContain("page-status-many-b");
  });

  test("hands back the employer beside the job", async () => {
    await seedCompany("page-co-linear", "Page Read Linear");
    await seedRow("page-job-linear", { status: "test", company_id: "page-co-linear" });

    const found = await service.findByStatuses(["test"]);
    const row = found.find((held) => held.job.id === "page-job-linear");

    expect(row?.company?.name).toBe("Page Read Linear");
  });

  // The relation is optional, and a job company association never matched is
  // the ordinary case rather than a broken row.
  test("hands back nothing in the employer's place where the job has none", async () => {
    await seedRow("page-job-no-employer", { status: "offer" });

    const found = await service.findByStatuses(["offer"]);
    const row = found.find((held) => held.job.id === "page-job-no-employer");

    expect(row?.job.company_id).toBeNull();
    expect(row?.company).toBeNull();
  });

  // The employer arrives through the one conversion the company service owns,
  // so its two stored lists come back as lists rather than as raw columns.
  test("hands back the employer's guessed categories as a list", async () => {
    await seedCompany("page-co-vercel", "Page Read Vercel");
    await db.company.update({
      where: { id: "page-co-vercel" },
      data: { scores_guessed: ["work_life_balance"] },
    });
    await seedRow("page-job-vercel", { status: "screening", company_id: "page-co-vercel" });

    const found = await service.findByStatuses(["screening"]);
    const row = found.find((held) => held.job.id === "page-job-vercel");

    expect(row?.company?.scores_guessed).toEqual(["work_life_balance"]);
  });

  // A page list covering no status shows nothing. Reading every job instead
  // would put the whole table under a heading that promised one status.
  test("gives back nothing where no status was asked for", async () => {
    expect(await service.findByStatuses([])).toEqual([]);
  });
});

// Criterion 175. The work log's entries name their jobs by id, and the
// employer's contact details are only reachable through the job.
describe("reading jobs by their ids", () => {
  test("gives back the jobs holding those ids, each with its employer", async () => {
    await seedCompany("page-ids-co", "Page Read Ramp");
    await seedRow("page-ids-a", { company_id: "page-ids-co" });
    await seedRow("page-ids-b", {});

    const found = await service.findByIds(["page-ids-a", "page-ids-b"]);
    const byId = new Map(found.map((row) => [row.job.id, row]));

    expect(byId.get("page-ids-a")?.company?.name).toBe("Page Read Ramp");
    expect(byId.get("page-ids-b")?.company).toBeNull();
  });

  // An entry outlives the job it names, so an id matching nothing is expected
  // rather than an error.
  test("passes over an id no job holds", async () => {
    await seedRow("page-ids-kept");

    const found = await service.findByIds(["page-ids-kept", "page-ids-deleted"]);

    expect(found.map((row) => row.job.id)).toEqual(["page-ids-kept"]);
  });

  test("gives back nothing where no id was asked for", async () => {
    expect(await service.findByIds([])).toEqual([]);
  });
});
