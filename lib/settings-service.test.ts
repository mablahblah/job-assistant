import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "./pipeline-db";
import {
  createSettingsService,
  type AtsCompany,
  type SettingsService,
  type TitleLevel,
} from "./settings-service";

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

// The words the seed fills each title vocabulary with. The head nouns are the
// measured list from the UX titles fixture plus the ones carried without
// firing in that domain; a noun the list has never seen is caught by the
// suffixes instead.
const EXPECTED_TITLE_HEAD_NOUNS = [
  "analyst", "architect", "artist", "consultant", "coordinator", "copywriter",
  "designer", "developer", "director", "engineer", "head", "lead", "manager",
  "owner", "producer", "programmer", "researcher", "scientist", "specialist",
  "strategist", "technician", "technologist", "translator", "vp", "writer",
];

// Word endings that name a person doing a job. Deliberately short, because a
// wrong match is left to become a real problem before the list grows.
const EXPECTED_TITLE_SUFFIXES = ["-er", "-or", "-ist", "-yst", "-ian", "-ant", "-ect"];

// Each seniority spelling that gets stored, with every spelling a posting
// might write for it. Deliberately restated rather than imported from
// scripts/db-seed.ts: this test seeds a real database and reads the list back,
// so importing the seed's own list would compare it to itself and prove
// nothing. It moves whenever SETTING_DEFAULTS does.
const EXPECTED_TITLE_LEVELS: TitleLevel[] = [
  { store: "Intern", match: ["intern"] },
  { store: "Entry-Level", match: ["entry level", "entry-level"] },
  { store: "Jr.", match: ["junior", "jr", "jr."] },
  { store: "Associate", match: ["associate", "assoc"] },
  { store: "Mid-Level", match: ["mid level", "mid-level", "mid"] },
  { store: "Sr.", match: ["senior", "sr", "sr."] },
  { store: "Staff", match: ["staff"] },
  { store: "Lead", match: ["lead"] },
  { store: "Principal", match: ["principal"] },
  { store: "Head", match: ["head"] },
  { store: "Director", match: ["director"] },
  { store: "VP", match: ["vp"] },
  { store: "Chief", match: ["chief"] },
];

// Words taken out of a title's team part only. It starts short and grows from
// what real output shows rather than from a list fitted in advance.
const EXPECTED_TITLE_REMOVAL_WORDS = ["w2", "c2h", "evergreen"];

// Sorting a level list by its stored spelling, and each level's own spellings,
// makes the comparison independent of the order either was written in.
function sortedLevels(levels: TitleLevel[]): TitleLevel[] {
  return [...levels]
    .map((level) => ({ store: level.store, match: [...level.match].sort() }))
    .sort((a, b) => a.store.localeCompare(b.store));
}

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

  test("exposes exactly the nine getters", () => {
    expect(Object.keys(service).sort()).toEqual(
      [
        "getAtsCompanies",
        "getExpiryThreshold",
        "getLocation",
        "getRadius",
        "getSearchTerms",
        "getTitleHeadNouns",
        "getTitleLevels",
        "getTitleRemovalWords",
        "getTitleSuffixes",
      ].sort()
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

// The title vocabularies fail the same way every other setting does: nothing
// configured yet must never look like a vocabulary a title can run against.
describe("the title vocabulary getters throw on an unseeded database", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;

  beforeAll(() => {
    const temp = createDb("pipeline-settings-title-unseeded-");
    dir = temp.dir;
    ({ db, service } = buildService(temp.url));
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("getTitleHeadNouns throws naming its column", async () => {
    await expect(service.getTitleHeadNouns()).rejects.toThrow(/title_head_nouns/);
  });

  test("getTitleLevels throws naming its column", async () => {
    await expect(service.getTitleLevels()).rejects.toThrow(/title_levels/);
  });

  test("getTitleSuffixes throws naming its column", async () => {
    await expect(service.getTitleSuffixes()).rejects.toThrow(/title_suffixes/);
  });

  test("getTitleRemovalWords throws naming its column", async () => {
    await expect(service.getTitleRemovalWords()).rejects.toThrow(/title_removal_words/);
  });

  test("the message points at the seed as the fix", async () => {
    await expect(service.getTitleHeadNouns()).rejects.toThrow(/seed/i);
  });
});

// A seeded row with one vocabulary nulled stands in for a setting added after
// the last seed ran. It is the same failure as no row at all.
describe("a Setting row that exists but has null title vocabulary columns still throws", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-settings-title-null-columns-");
    dir = temp.dir;
    await runSql(
      temp.url,
      "UPDATE Setting SET title_head_nouns = NULL, title_levels = NULL, title_suffixes = NULL, " +
        "title_removal_words = NULL WHERE id = 1"
    );
    ({ db, service } = buildService(temp.url));
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("a null title_head_nouns column throws naming it", async () => {
    await expect(service.getTitleHeadNouns()).rejects.toThrow(/title_head_nouns/);
  });

  test("a null title_levels column throws naming it", async () => {
    await expect(service.getTitleLevels()).rejects.toThrow(/title_levels/);
  });

  test("a null title_suffixes column throws naming it", async () => {
    await expect(service.getTitleSuffixes()).rejects.toThrow(/title_suffixes/);
  });

  test("a null title_removal_words column throws naming it", async () => {
    await expect(service.getTitleRemovalWords()).rejects.toThrow(/title_removal_words/);
  });
});

// An empty vocabulary differs from an empty search-term list: nothing to
// search for is a real answer, but nothing to recognise as a job noun, level,
// suffix or removal word degrades every title silently rather than failing.
describe("a title vocabulary set to an empty list still throws", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-settings-title-empty-list-");
    dir = temp.dir;
    await runSql(
      temp.url,
      "UPDATE Setting SET title_head_nouns = '[]', title_levels = '[]', title_suffixes = '[]', " +
        "title_removal_words = '[]' WHERE id = 1"
    );
    ({ db, service } = buildService(temp.url));
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("getTitleHeadNouns throws rather than returning an empty list", async () => {
    await expect(service.getTitleHeadNouns()).rejects.toThrow(/title_head_nouns/);
  });

  test("getTitleLevels throws rather than returning an empty list", async () => {
    await expect(service.getTitleLevels()).rejects.toThrow(/title_levels/);
  });

  test("getTitleSuffixes throws rather than returning an empty list", async () => {
    await expect(service.getTitleSuffixes()).rejects.toThrow(/title_suffixes/);
  });

  test("getTitleRemovalWords throws rather than returning an empty list", async () => {
    await expect(service.getTitleRemovalWords()).rejects.toThrow(/title_removal_words/);
  });
});

// A vocabulary is a Json column, so its static type is JsonValue rather than a
// list of strings. A stray entry of the wrong type has to be caught at read
// time or it reaches the normalizer trusted.
describe("a title vocabulary holding an entry of the wrong type throws", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-settings-title-bad-entry-");
    dir = temp.dir;
    await runSql(
      temp.url,
      "UPDATE Setting SET title_head_nouns = '[\"designer\", 42]', " +
        "title_suffixes = '[\"-er\", 7]', title_removal_words = '[\"w2\", true]', " +
        "title_levels = '[{\"store\":123,\"match\":[\"sr\"]}]' WHERE id = 1"
    );
    ({ db, service } = buildService(temp.url));
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("a non-string entry in title_head_nouns throws naming it", async () => {
    await expect(service.getTitleHeadNouns()).rejects.toThrow(/title_head_nouns/);
  });

  test("a non-string entry in title_suffixes throws naming it", async () => {
    await expect(service.getTitleSuffixes()).rejects.toThrow(/title_suffixes/);
  });

  test("a non-string entry in title_removal_words throws naming it", async () => {
    await expect(service.getTitleRemovalWords()).rejects.toThrow(/title_removal_words/);
  });

  test("a level whose stored spelling is not a string throws naming its column", async () => {
    await expect(service.getTitleLevels()).rejects.toThrow(/title_levels/);
  });
});

// A level holds objects rather than plain strings, so it has malformed shapes
// of its own that a string check would never see.
describe("getTitleLevels rejects a malformed level", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;
  let url: string;

  beforeAll(() => {
    const temp = createAndSeed("pipeline-settings-title-levels-shape-");
    dir = temp.dir;
    url = temp.url;
    ({ db, service } = buildService(temp.url));
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("a level that is a plain string throws", async () => {
    await runSql(url, "UPDATE Setting SET title_levels = '[\"Sr.\"]' WHERE id = 1");
    await expect(service.getTitleLevels()).rejects.toThrow(/title_levels/);
  });

  test("a level with no spellings to match throws", async () => {
    await runSql(url, "UPDATE Setting SET title_levels = '[{\"store\":\"Sr.\"}]' WHERE id = 1");
    await expect(service.getTitleLevels()).rejects.toThrow(/title_levels/);
  });

  test("a non-string spelling inside a level throws", async () => {
    await runSql(
      url,
      "UPDATE Setting SET title_levels = '[{\"store\":\"Sr.\",\"match\":[\"sr\", 5]}]' WHERE id = 1"
    );
    await expect(service.getTitleLevels()).rejects.toThrow(/title_levels/);
  });

  // A level nothing can match is a level that will never fire, which is the
  // same silent degradation as an empty vocabulary.
  test("a level with an empty spelling list throws", async () => {
    await runSql(
      url,
      "UPDATE Setting SET title_levels = '[{\"store\":\"Sr.\",\"match\":[]}]' WHERE id = 1"
    );
    await expect(service.getTitleLevels()).rejects.toThrow(/title_levels/);
  });
});

describe("the title vocabulary getters return what the seed writes", () => {
  let dir: string;
  let db: PipelineDb;
  let service: SettingsService;

  beforeAll(() => {
    const temp = createAndSeed("pipeline-settings-title-seeded-");
    dir = temp.dir;
    ({ db, service } = buildService(temp.url));
  }, SEED_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("getTitleHeadNouns returns the seeded head nouns", async () => {
    expect([...(await service.getTitleHeadNouns())].sort()).toEqual(
      [...EXPECTED_TITLE_HEAD_NOUNS].sort()
    );
  });

  test("getTitleSuffixes returns the seeded suffixes", async () => {
    expect([...(await service.getTitleSuffixes())].sort()).toEqual(
      [...EXPECTED_TITLE_SUFFIXES].sort()
    );
  });

  test("getTitleLevels returns the seeded levels with their stored spelling", async () => {
    expect(sortedLevels(await service.getTitleLevels())).toEqual(
      sortedLevels(EXPECTED_TITLE_LEVELS)
    );
  });

  test("getTitleRemovalWords returns the seeded removal words", async () => {
    expect([...(await service.getTitleRemovalWords())].sort()).toEqual(
      [...EXPECTED_TITLE_REMOVAL_WORDS].sort()
    );
  });

  // Senior, Sr and Sr. are one level, which is the whole reason a level
  // carries its spellings rather than standing as a plain word.
  test("Senior, Sr and Sr. all store as one spelling", async () => {
    const levels = await service.getTitleLevels();
    const sr = levels.find((level) => level.store === "Sr.");
    expect(sr?.match).toEqual(expect.arrayContaining(["senior", "sr", "sr."]));
  });
});
