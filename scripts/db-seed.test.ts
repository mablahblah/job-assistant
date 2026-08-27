import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Creating plus seeding measured well under two seconds. These are ceilings
// rather than budgets: the multi one covers a block that seeds several times.
const SEED_TIMEOUT_MS = 45_000;
const MULTI_SEED_TIMEOUT_MS = 120_000;

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
const ALL_ATS_SLUGS = [...GREENHOUSE_SLUGS, ...LEVER_SLUGS, ...ASHBY_SLUGS];

interface SettingRow {
  search_terms: string[] | null;
  location: string | null;
  radius: number | null;
  expiry_threshold: number | null;
  modified_at: string;
}

interface CompanyRow {
  name: string;
  ats_platform: string | null;
  ats_slug: string | null;
}

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

// Runs a real command against a scratch database. The url travels in the
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

function createAndSeed(prefix: string): { dir: string; url: string } {
  const temp = makeTempDb(prefix);
  runScript("db-create.ts", temp.url);
  runScript("db-seed.ts", temp.url);
  return temp;
}

async function readSetting(url: string): Promise<SettingRow> {
  const client = createClient({ url });
  try {
    const result = await client.execute("SELECT * FROM Setting WHERE id = 1");
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
    if (!row) throw new Error("Setting row is missing");
    // search_terms is a Json column, which comes back through raw sql as a
    // text string holding json rather than as an array.
    const rawTerms = row["search_terms"];
    return {
      search_terms: typeof rawTerms === "string" ? (JSON.parse(rawTerms) as string[]) : null,
      location: row["location"] === null ? null : String(row["location"]),
      radius: row["radius"] === null ? null : Number(row["radius"]),
      expiry_threshold:
        row["expiry_threshold"] === null ? null : Number(row["expiry_threshold"]),
      modified_at: String(row["modified_at"]),
    };
  } finally {
    client.close();
  }
}

async function readCompanies(url: string): Promise<CompanyRow[]> {
  const client = createClient({ url });
  try {
    const result = await client.execute(
      "SELECT name, ats_platform, ats_slug FROM Company"
    );
    return result.rows.map((row) => {
      const record = row as unknown as Record<string, unknown>;
      return {
        name: String(record["name"]),
        ats_platform:
          record["ats_platform"] === null ? null : String(record["ats_platform"]),
        ats_slug: record["ats_slug"] === null ? null : String(record["ats_slug"]),
      };
    });
  } finally {
    client.close();
  }
}

async function countRows(url: string, table: string): Promise<number> {
  const client = createClient({ url });
  try {
    const result = await client.execute(`SELECT count(*) as count FROM ${table}`);
    const row = result.rows[0] as unknown as Record<string, unknown>;
    return Number(row["count"]);
  } finally {
    client.close();
  }
}

async function runSql(
  url: string,
  sql: string,
  args: Array<string | number | null> = []
): Promise<void> {
  const client = createClient({ url });
  try {
    await client.execute({ sql, args });
  } finally {
    client.close();
  }
}

// The slugs a collector would poll for one platform, which is how a collector
// finds its boards: the companies carrying that platform and a slug.
function slugsFor(companies: CompanyRow[], platform: string): string[] {
  return companies
    .filter((company) => company.ats_platform === platform)
    .map((company) => company.ats_slug ?? "")
    .sort();
}

// Separators become spaces and each word gets a capital first letter, leaving
// the rest of the word alone so an already-mixed slug keeps its shape.
function expectedCompanyName(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

describe("AC6: seeding a fresh database fills every setting collection needs", () => {
  let dir: string;
  let setting: SettingRow;
  let companies: CompanyRow[];

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-ac6-");
    dir = temp.dir;
    setting = await readSetting(temp.url);
    companies = await readCompanies(temp.url);
  }, SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes the search terms", () => {
    expect(setting.search_terms).toEqual(EXPECTED_SEARCH_TERMS);
  });

  test("writes the location", () => {
    expect(setting.location).toBe(EXPECTED_LOCATION);
  });

  test("writes the radius", () => {
    expect(setting.radius).toBe(EXPECTED_RADIUS);
  });

  test("writes the expiry threshold", () => {
    expect(setting.expiry_threshold).toBe(EXPECTED_EXPIRY_THRESHOLD);
  });

  test("writes one company per ATS slug", () => {
    const slugs = companies.map((company) => company.ats_slug).sort();
    expect(slugs).toEqual([...ALL_ATS_SLUGS].sort());
  });

  test.each(ALL_ATS_SLUGS)("names the company for %s from its slug", (slug) => {
    const company = companies.find((candidate) => candidate.ats_slug === slug);
    expect(company?.name).toBe(expectedCompanyName(slug));
  });
});

describe("AC7: re-seeding never resets a setting that already has a value", () => {
  const myTerms = ["Staff Product Designer", "Design Systems"];

  let dir: string;
  let setting: SettingRow;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-ac7-");
    dir = temp.dir;
    await runSql(temp.url, "UPDATE Setting SET search_terms = ? WHERE id = 1", [
      JSON.stringify(myTerms),
    ]);
    runScript("db-seed.ts", temp.url);
    setting = await readSetting(temp.url);
  }, MULTI_SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("keeps the search terms I changed", () => {
    expect(setting.search_terms).toEqual(myTerms);
  });

  test("leaves the location alone", () => {
    expect(setting.location).toBe(EXPECTED_LOCATION);
  });

  test("leaves the radius alone", () => {
    expect(setting.radius).toBe(EXPECTED_RADIUS);
  });

  test("leaves the expiry threshold alone", () => {
    expect(setting.expiry_threshold).toBe(EXPECTED_EXPIRY_THRESHOLD);
  });
});

describe("AC8: seeding writes only the setting that is missing", () => {
  let dir: string;
  let modifiedAtBefore: string;
  let modifiedAtAfter: string;
  let refilled: SettingRow;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-ac8-");
    dir = temp.dir;

    // Nothing is absent, so this run should write nothing at all.
    modifiedAtBefore = (await readSetting(temp.url)).modified_at;
    runScript("db-seed.ts", temp.url);
    modifiedAtAfter = (await readSetting(temp.url)).modified_at;

    // A column back at null stands in for a setting added after the last seed.
    await runSql(temp.url, "UPDATE Setting SET location = NULL WHERE id = 1");
    runScript("db-seed.ts", temp.url);
    refilled = await readSetting(temp.url);
  }, MULTI_SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("seeding a complete database leaves modified_at where it was", () => {
    expect(modifiedAtAfter).toBe(modifiedAtBefore);
  });

  test("fills the setting that was missing", () => {
    expect(refilled.location).toBe(EXPECTED_LOCATION);
  });

  test("leaves the search terms untouched while filling another setting", () => {
    expect(refilled.search_terms).toEqual(EXPECTED_SEARCH_TERMS);
  });

  test("leaves the radius untouched while filling another setting", () => {
    expect(refilled.radius).toBe(EXPECTED_RADIUS);
  });

  test("leaves the expiry threshold untouched while filling another setting", () => {
    expect(refilled.expiry_threshold).toBe(EXPECTED_EXPIRY_THRESHOLD);
  });
});

describe("AC12: the Greenhouse slug list holds the boards that return jobs", () => {
  let dir: string;
  let greenhouse: string[];

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-ac12-");
    dir = temp.dir;
    greenhouse = slugsFor(await readCompanies(temp.url), "greenhouse");
  }, SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("holds the 13 boards measured to return jobs", () => {
    expect(greenhouse).toEqual([...GREENHOUSE_SLUGS].sort());
  });

  test("does not hold hubspot, which returns none", () => {
    expect(greenhouse).not.toContain("hubspot");
  });
});

describe("AC13: the Lever and Ashby slug lists give each collector something to poll", () => {
  let dir: string;
  let lever: string[];
  let ashby: string[];

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-ac13-");
    dir = temp.dir;
    const companies = await readCompanies(temp.url);
    lever = slugsFor(companies, "lever");
    ashby = slugsFor(companies, "ashby");
  }, SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("Lever holds the boards measured to return matching jobs", () => {
    expect(lever).toEqual([...LEVER_SLUGS].sort());
  });

  test("Lever has at least one board to poll", () => {
    expect(lever.length).toBeGreaterThan(0);
  });

  test("Ashby holds the boards measured to return matching jobs", () => {
    expect(ashby).toEqual([...ASHBY_SLUGS].sort());
  });

  test("Ashby has at least one board to poll", () => {
    expect(ashby.length).toBeGreaterThan(0);
  });
});

describe("seeding twice does not duplicate companies", () => {
  let dir: string;
  let first: number;
  let second: number;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-twice-");
    dir = temp.dir;
    first = await countRows(temp.url, "Company");
    runScript("db-seed.ts", temp.url);
    second = await countRows(temp.url, "Company");
  }, MULTI_SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("the company count is the same after a second seed", () => {
    expect(second).toBe(first);
  });
});

// Every other test hands the url to the script directly. Running it the way a
// user does means the url comes from .env instead, so this is the only test
// that would notice the script failing to load it.
describe("the seed reads the database url from .env when it is absent from the environment", () => {
  let dir: string;
  let url: string;

  beforeAll(() => {
    const temp = makeTempDb("pipeline-seed-dotenv-");
    dir = temp.dir;
    url = temp.url;
    runScript("db-create.ts", url);

    const envPath = join(dir, ".env");
    writeFileSync(envPath, `PIPELINE_DATABASE_URL="${url}"\n`);
    const childEnv: NodeJS.ProcessEnv = { ...process.env, DOTENV_CONFIG_PATH: envPath };
    delete childEnv["PIPELINE_DATABASE_URL"];
    execFileSync("npx", ["tsx", "scripts/db-seed.ts"], {
      cwd: repoRoot,
      env: childEnv,
      stdio: "pipe",
    });
  }, SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("the settings land in the database named by .env", async () => {
    expect((await readSetting(url)).search_terms).toEqual(EXPECTED_SEARCH_TERMS);
  });
});
