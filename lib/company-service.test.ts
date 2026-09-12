import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Prisma } from "../generated/pipeline/client";
import { createPipelineDb } from "./pipeline-db";
import { companyMatchKey } from "./company-match-key";
import { createCompanyService, type CompanyService } from "./company-service";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..");

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
  test("returns the company holding that slug", async () => {
    await db.company.create({
      data: { ats_platform: "greenhouse", ats_slug: "find-by-slug-hit" },
    });

    const found = await service.findBySlug("find-by-slug-hit");

    expect(found?.ats_slug).toBe("find-by-slug-hit");
    expect(found?.ats_platform).toBe("greenhouse");
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

  // The seed's case. An ATS company is known only by the board it posts on.
  test("writes a slug and its platform with no name", async () => {
    const result = await service.create({
      ats_platform: "ashby",
      ats_slug: "created-by-slug",
    });

    expect(result.created).toBe(true);
    expect(result.company.ats_slug).toBe("created-by-slug");
    expect(result.company.ats_platform).toBe("ashby");
    expect(result.company.name).toBeNull();
    expect(result.company.match_key).toBeNull();
  });

  // AC 4. A record identified by nothing could never be matched again, so this
  // is a caller bug rather than an ordinary outcome, and it throws.
  test("refuses a record carrying neither a name nor a slug", async () => {
    await expect(service.create({})).rejects.toThrow(/name|slug/i);
  });

  // An empty name is no name. The tidy strips a name like "-" to nothing, and
  // SQLite treats an empty string as an ordinary value in a unique index.
  test("refuses a record whose only name is empty", async () => {
    await expect(service.create({ name: "" })).rejects.toThrow(/name|slug/i);
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

  // The seed is the only caller that creates by slug, and a company already
  // holding that slug is the company the caller wanted. Recovering here is
  // what lets the seed warn on a clash instead of falling over.
  test("attaches the company already holding that slug", async () => {
    const first = await service.create({ ats_platform: "ashby", ats_slug: "clashing-slug" });

    const second = await service.create({ ats_platform: "ashby", ats_slug: "clashing-slug" });

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

  test("looks up only the slug where the slug is the column named", async () => {
    const first = await service.create({
      ats_platform: "greenhouse",
      ats_slug: "one-lookup-slug",
    });
    const lookups: unknown[] = [];
    const watched = createCompanyService(recordingDb(db, lookups));

    const second = await watched.create({
      name: "One Lookup Slug Newcomer",
      ats_slug: "one-lookup-slug",
    });

    expect(second.created).toBe(false);
    expect(second.company.id).toBe(first.company.id);
    expect(lookups).toEqual([{ ats_slug: "one-lookup-slug" }]);
  });

  test("looks up only the column a refused name fill names", async () => {
    const holder = await service.create({ name: "Fill One Lookup Group" });
    const target = await db.company.create({
      data: { ats_platform: "lever", ats_slug: "fill-one-lookup" },
    });
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
    const created = await db.company.create({
      data: { ats_platform: "lever", ats_slug: "fill-name-target" },
    });

    const result = await service.fillName(created.id, "Fill Name Target");

    expect(result.filled).toBe(true);
    expect(result.company.name).toBe("Fill Name Target");
    expect(result.company.match_key).toBe("fillnametarget");
  });

  // AC 36. Association never writes a company's ATS platform or slug — a
  // company earns being polled by scoring, not by being met once.
  test("leaves the platform and slug untouched", async () => {
    const created = await db.company.create({
      data: { ats_platform: "greenhouse", ats_slug: "fill-keeps-slug" },
    });

    const result = await service.fillName(created.id, "Fill Keeps Slug");

    expect(result.company.ats_platform).toBe("greenhouse");
    expect(result.company.ats_slug).toBe("fill-keeps-slug");
  });

  // AC 35 and 55. An ordinary event, not a crash: two spellings of one
  // employer, one already named. The name is not written, the company the job
  // matched is handed back unchanged, and the holder is named so the step can
  // warn about a merge only the user can make.
  test("refuses a name another company already holds, and names the holder", async () => {
    const holder = await service.create({ name: "Name Clash Holder" });
    const target = await db.company.create({
      data: { ats_platform: "ashby", ats_slug: "name-clash-target" },
    });

    const result = await service.fillName(target.id, "Name Clash Holder");

    expect(result.filled).toBe(false);
    expect(result.company.id).toBe(target.id);
    expect(result.company.name).toBeNull();
    expect(result.heldBy?.id).toBe(holder.company.id);
  });
});
