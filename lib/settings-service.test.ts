import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "./pipeline-db";
import { createSettingsService, type AtsCompany, type SettingsService } from "./settings-service";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..");

// Creating plus seeding measured well under two seconds. This is a ceiling
// rather than a budget.
const SEED_TIMEOUT_MS = 45_000;

const EXPECTED_SEARCH_TERMS = ["Product Design", "UX", "Founding Design"];
const EXPECTED_LOCATION = "78701";
const EXPECTED_RADIUS = 30;
const EXPECTED_EXPIRY_THRESHOLD = 8;

const GREENHOUSE_SLUGS = [
  "gitlab",
  "duolingo",
  "stripe",
  "asana",
  "lyft",
  "dropbox",
  "squarespace",
  "hellofresh",
  "intercom",
  "coursera",
  "modernhealth",
  "calm",
  "figma",
];
const LEVER_SLUGS = ["gohighlevel", "USMobile", "bhvr"];
const ASHBY_SLUGS = ["hinge-health", "legora", "bjakcareer", "voodoo", "scorewarrior"];

type PipelineDb = ReturnType<typeof createPipelineDb>;

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

// Runs a real script against a scratch database. The url travels in the
// environment because dotenv never overwrites a variable that is already set,
// so this value wins over the repo's .env and the real pipeline.db is never
// touched.
function runScript(script: string, url: string): void {
  execFileSync("npx", ["tsx", `scripts/${script}`], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

// Schema only, nothing seeded — stands in for a database no one has run
// db:seed against yet.
function createDb(prefix: string): { dir: string; url: string } {
  const temp = makeTempDb(prefix);
  runScript("db-create.ts", temp.url);
  return temp;
}

function createAndSeed(prefix: string): { dir: string; url: string } {
  const temp = createDb(prefix);
  runScript("db-seed.ts", temp.url);
  return temp;
}

async function runSql(url: string, sql: string): Promise<void> {
  const client = createClient({ url });
  try {
    await client.execute(sql);
  } finally {
    client.close();
  }
}

// Points a real client at the scratch database. createPipelineDb reads the
// url at call time, so the environment only has to hold the scratch value for
// the moment of construction, and whatever was there before is put back.
function buildService(url: string): { db: PipelineDb; service: SettingsService } {
  const previous = process.env["PIPELINE_DATABASE_URL"];
  process.env["PIPELINE_DATABASE_URL"] = url;
  const db = createPipelineDb();
  if (previous === undefined) delete process.env["PIPELINE_DATABASE_URL"];
  else process.env["PIPELINE_DATABASE_URL"] = previous;
  return { db, service: createSettingsService(db) };
}

async function cleanup(dir: string, db: PipelineDb): Promise<void> {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
}

// AC 9. A collector must never mistake "nothing configured yet" for "nothing
// to search for", so an unseeded database fails loudly on the first setting
// read. Companies are the exception: an empty board list is how a platform is
// switched off, so it is a real answer rather than a failure.
describe("AC 9: an unseeded database throws instead of returning something empty", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;

  beforeAll(() => {
    const temp = createDb("pipeline-settings-unseeded-");
    dir = temp.dir;
    ({ db, service } = buildService(temp.url));
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("getSearchTerms throws rather than returning an empty list", async () => {
    await expect(service.getSearchTerms()).rejects.toThrow(/search_terms/);
  });

  test("the message points at the seed as the fix", async () => {
    await expect(service.getSearchTerms()).rejects.toThrow(/seed/i);
  });

  test("getLocation throws rather than returning an empty string", async () => {
    await expect(service.getLocation()).rejects.toThrow(/location/);
  });

  test("getRadius throws rather than returning zero", async () => {
    await expect(service.getRadius()).rejects.toThrow(/radius/);
  });

  test("getExpiryThreshold throws rather than returning zero", async () => {
    await expect(service.getExpiryThreshold()).rejects.toThrow(/expiry_threshold/);
  });

  test("getAtsCompanies returns an empty list, because no boards is a real answer", async () => {
    expect(await service.getAtsCompanies("greenhouse")).toEqual([]);
  });
});

// AC 10. The service is a read model for collectors, not an admin surface.
// It shares the unseeded database above because it writes nothing.
describe("AC 10: the settings service exposes reads only", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;

  beforeAll(() => {
    const temp = createDb("pipeline-settings-surface-");
    dir = temp.dir;
    ({ db, service } = buildService(temp.url));
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("exposes exactly the five getters", () => {
    expect(Object.keys(service).sort()).toEqual(
      ["getAtsCompanies", "getExpiryThreshold", "getLocation", "getRadius", "getSearchTerms"].sort()
    );
  });

  test("exposes no create, update, delete, set, write, save, or upsert method", () => {
    const forbidden = /create|update|delete|set|write|save|upsert/i;
    for (const key of Object.keys(service)) {
      expect(key).not.toMatch(forbidden);
    }
  });
});

describe("the getters return what the seed writes", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;

  beforeAll(() => {
    const temp = createAndSeed("pipeline-settings-seeded-");
    dir = temp.dir;
    ({ db, service } = buildService(temp.url));
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("getSearchTerms returns the seeded terms", async () => {
    expect(await service.getSearchTerms()).toEqual(EXPECTED_SEARCH_TERMS);
  });

  test("getLocation returns the seeded location", async () => {
    expect(await service.getLocation()).toBe(EXPECTED_LOCATION);
  });

  test("getRadius returns the seeded radius", async () => {
    expect(await service.getRadius()).toBe(EXPECTED_RADIUS);
  });

  test("getExpiryThreshold returns the seeded expiry threshold", async () => {
    expect(await service.getExpiryThreshold()).toBe(EXPECTED_EXPIRY_THRESHOLD);
  });

  test("getAtsCompanies('greenhouse') returns the seeded greenhouse boards", async () => {
    const companies = await service.getAtsCompanies("greenhouse");
    expect(companies.map((company) => company.ats_slug).sort()).toEqual(
      [...GREENHOUSE_SLUGS].sort()
    );
  });

  test("getAtsCompanies('lever') returns the seeded lever boards", async () => {
    const companies = await service.getAtsCompanies("lever");
    expect(companies.map((company) => company.ats_slug).sort()).toEqual([...LEVER_SLUGS].sort());
  });

  test("getAtsCompanies('ashby') returns the seeded ashby boards", async () => {
    const companies = await service.getAtsCompanies("ashby");
    expect(companies.map((company) => company.ats_slug).sort()).toEqual([...ASHBY_SLUGS].sort());
  });

  test("a company carries its name alongside its slug", async () => {
    const companies = await service.getAtsCompanies("ashby");
    const hingeHealth = companies.find((company) => company.ats_slug === "hinge-health");
    expect(hingeHealth?.name).toBe("Hinge Health");
  });
});

// A row that exists with a null column stands in for a setting added after
// the last seed ran. It is the same failure as no row at all.
describe("a Setting row that exists but has null columns still throws", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-settings-null-columns-");
    dir = temp.dir;
    await runSql(
      temp.url,
      "UPDATE Setting SET search_terms = NULL, location = NULL, radius = NULL, " +
        "expiry_threshold = NULL WHERE id = 1"
    );
    ({ db, service } = buildService(temp.url));
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("a null search_terms column throws naming it", async () => {
    await expect(service.getSearchTerms()).rejects.toThrow(/search_terms/);
  });

  test("a null location column throws naming it", async () => {
    await expect(service.getLocation()).rejects.toThrow(/location/);
  });

  test("a null radius column throws naming it", async () => {
    await expect(service.getRadius()).rejects.toThrow(/radius/);
  });

  test("a null expiry_threshold column throws naming it", async () => {
    await expect(service.getExpiryThreshold()).rejects.toThrow(/expiry_threshold/);
  });
});

// AC 11. A company added after the seed proves the list comes from the
// database, because a hardcoded one could not know about it.
describe("AC 11: getAtsCompanies reads the live company list rather than a hardcoded one", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;
  let companies: AtsCompany[];

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-settings-live-list-");
    dir = temp.dir;
    ({ db, service } = buildService(temp.url));
    await db.company.create({
      data: { name: "Extra Co", ats_platform: "greenhouse", ats_slug: "extra-co" },
    });
    companies = await service.getAtsCompanies("greenhouse");
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("picks up a company added after the seed ran", () => {
    expect(companies.map((company) => company.ats_slug)).toContain("extra-co");
  });

  test("returns every greenhouse board, not a fixed set", () => {
    expect(companies.length).toBe(GREENHOUSE_SLUGS.length + 1);
  });
});

describe("a company on the platform without a slug is left out", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;
  let temp: { dir: string; url: string };

  beforeAll(async () => {
    temp = createAndSeed("pipeline-settings-null-slug-");
    dir = temp.dir;
    await runSql(temp.url, "UPDATE Company SET ats_slug = NULL WHERE ats_slug = 'gitlab'");
    ({ db, service } = buildService(temp.url));
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("the company with no slug is dropped", async () => {
    const companies = await service.getAtsCompanies("greenhouse");
    expect(companies.map((company) => company.ats_slug)).not.toContain("gitlab");
    expect(companies.length).toBe(GREENHOUSE_SLUGS.length - 1);
  });

  test("a platform where no company still has a slug comes back empty", async () => {
    await runSql(temp.url, "UPDATE Company SET ats_slug = NULL WHERE ats_platform = 'lever'");
    expect(await service.getAtsCompanies("lever")).toEqual([]);
  });
});

// Every other test builds the service in-process, where the url is already in
// the environment. This is the only test that would notice the service failing
// to load .env, because the child process never receives the variable and
// never loads dotenv itself.
describe("AC 75: the settings service finds the database url in .env when it is absent from the environment", () => {
  let dir: string;
  let output: string;

  beforeAll(() => {
    const temp = createAndSeed("pipeline-settings-dotenv-");
    dir = temp.dir;

    const envPath = join(dir, ".env");
    writeFileSync(envPath, `PIPELINE_DATABASE_URL="${temp.url}"\n`);
    const childEnv: NodeJS.ProcessEnv = { ...process.env, DOTENV_CONFIG_PATH: envPath };
    delete childEnv["PIPELINE_DATABASE_URL"];

    const code = [
      'const { createPipelineDb } = require("./lib/pipeline-db");',
      'const { createSettingsService } = require("./lib/settings-service");',
      "(async () => {",
      "  const db = createPipelineDb();",
      "  const service = createSettingsService(db);",
      "  console.log(await service.getLocation());",
      "  await db.$disconnect();",
      "})();",
    ].join("\n");

    output = execFileSync("npx", ["tsx", "-e", code], {
      cwd: repoRoot,
      env: childEnv,
      encoding: "utf8",
    });
  }, SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reads the setting from the database named by .env", () => {
    expect(output.trim()).toBe(EXPECTED_LOCATION);
  });
});
