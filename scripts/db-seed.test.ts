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
// Raised from 45 seconds, which a full-suite run exceeded: vitest runs
// these child processes in parallel and they contend for the machine.
const SEED_TIMEOUT_MS = 120_000;
const MULTI_SEED_TIMEOUT_MS = 240_000;

const EXPECTED_SEARCH_TERMS = ["Product Design", "UX", "Founding Design"];
const EXPECTED_LOCATION = "78701";
const EXPECTED_RADIUS = 30;
const EXPECTED_EXPIRY_THRESHOLD = 8;
const EXPECTED_FAST_CONCURRENCY = 3;
const EXPECTED_SLOW_CONCURRENCY = 1;
const EXPECTED_SLOW_PAUSE_SECONDS = 12;
const EXPECTED_REPOST_GAP_DAYS = 3;
// A flat 3 everywhere is what the company rubric awards when nothing public
// was found, so the bar sits above it: a company is never promoted on guesses.
const EXPECTED_PROMOTION_THRESHOLD = 3.5;
const EXPECTED_SCORE_EXPIRY_DAYS = 90;
const EXPECTED_GUESSED_SCORE_EXPIRY_DAYS = 30;

interface SettingRow {
  search_terms: string[] | null;
  title_head_nouns: string[] | null;
  source_priority_list: string[] | null;
  location: string | null;
  radius: number | null;
  expiry_threshold: number | null;
  resolution_fast_concurrency: number | null;
  resolution_slow_concurrency: number | null;
  resolution_slow_pause_seconds: number | null;
  repost_gap_days: number | null;
  promotion_threshold: number | null;
  score_expiry_days: number | null;
  guessed_score_expiry_days: number | null;
  modified_at: string;
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
  // db-create takes its target as an argument and refuses to run without
  // one; every other script still reads the url from the environment.
  const args = script === "db-create.ts" ? [url] : [];
  execFileSync("npx", ["tsx", `scripts/${script}`, ...args], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

// The same run as runScript, but handing back everything the script printed.
// Only the tests that check a warning need this.
function runScriptForOutput(script: string, url: string): string {
  return execFileSync("npx", ["tsx", `scripts/${script}`], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    encoding: "utf8",
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
    const rawNouns = row["title_head_nouns"];
    const rawPriority = row["source_priority_list"];
    return {
      search_terms: typeof rawTerms === "string" ? (JSON.parse(rawTerms) as string[]) : null,
      title_head_nouns: typeof rawNouns === "string" ? (JSON.parse(rawNouns) as string[]) : null,
      source_priority_list:
        typeof rawPriority === "string" ? (JSON.parse(rawPriority) as string[]) : null,
      location: row["location"] === null ? null : String(row["location"]),
      radius: row["radius"] === null ? null : Number(row["radius"]),
      expiry_threshold:
        row["expiry_threshold"] === null ? null : Number(row["expiry_threshold"]),
      resolution_fast_concurrency:
        row["resolution_fast_concurrency"] === null
          ? null
          : Number(row["resolution_fast_concurrency"]),
      resolution_slow_concurrency:
        row["resolution_slow_concurrency"] === null
          ? null
          : Number(row["resolution_slow_concurrency"]),
      resolution_slow_pause_seconds:
        row["resolution_slow_pause_seconds"] === null
          ? null
          : Number(row["resolution_slow_pause_seconds"]),
      repost_gap_days:
        row["repost_gap_days"] === null ? null : Number(row["repost_gap_days"]),
      promotion_threshold:
        row["promotion_threshold"] === null ? null : Number(row["promotion_threshold"]),
      score_expiry_days:
        row["score_expiry_days"] === null ? null : Number(row["score_expiry_days"]),
      guessed_score_expiry_days:
        row["guessed_score_expiry_days"] === null
          ? null
          : Number(row["guessed_score_expiry_days"]),
      modified_at: String(row["modified_at"]),
    };
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

// Criteria "The seed creates no board rows" and "The seed marks no employer
// polled". From the switch over on, polling is earned by promotion alone, and
// seeding is a routine, repeatable command — a slug list left in it would
// re-arm the boards on the next reseed.
describe("the seed arms no polling", () => {
  let dir: string;
  let boardRows: number;
  let companyRows: number;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-no-boards-");
    dir = temp.dir;
    boardRows = await countRows(temp.url, "AtsSlug");
    companyRows = await countRows(temp.url, "Company");
  }, SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("it creates no board rows", () => {
    expect(boardRows).toBe(0);
  });

  // The seed used to create a nameless company per board slug, which is what
  // marked those employers as polled. No boards means no companies either.
  test("it creates no companies", () => {
    expect(companyRows).toBe(0);
  });
});

describe("the seed leaves an existing unpolled board unpolled", () => {
  let dir: string;
  let collectorAfter: string | null;

  beforeAll(async () => {
    const temp = makeTempDb("pipeline-seed-unpolled-");
    dir = temp.dir;
    runScript("db-create.ts", temp.url);
    // A board row promotion has not filled yet, the state company matching
    // leaves behind. modified_at has no database default, so a raw insert
    // has to supply it.
    await runSql(
      temp.url,
      "INSERT INTO Company (id, name, match_key, created_at, modified_at) " +
        "VALUES ('met-once', 'Figma', 'figma', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    );
    await runSql(
      temp.url,
      "INSERT INTO AtsSlug (id, slug, company_id, parser, created_at, modified_at) " +
        "VALUES ('met-once-board', 'figma', 'met-once', 'greenhouse', " +
        "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    );
    runScript("db-seed.ts", temp.url);

    const client = createClient({ url: temp.url });
    try {
      const result = await client.execute("SELECT collector FROM AtsSlug WHERE slug = 'figma'");
      const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
      collectorAfter = row?.["collector"] === null ? null : String(row?.["collector"]);
    } finally {
      client.close();
    }
  }, SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("the board still names no collector", () => {
    expect(collectorAfter).toBeNull();
  });
});

describe("AC6: seeding a fresh database fills every setting collection needs", () => {
  let dir: string;
  let setting: SettingRow;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-ac6-");
    dir = temp.dir;
    setting = await readSetting(temp.url);
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

  test("writes how many jobs resolution resolves at a time", () => {
    expect(setting.resolution_fast_concurrency).toBe(EXPECTED_FAST_CONCURRENCY);
    expect(setting.resolution_slow_concurrency).toBe(EXPECTED_SLOW_CONCURRENCY);
    expect(setting.resolution_slow_pause_seconds).toBe(EXPECTED_SLOW_PAUSE_SECONDS);
  });

  // AC 104. Three days is what absorbs two collectors disagreeing by hours
  // about one posting, which is the whole reason the gap exists.
  test("writes the repost gap", () => {
    expect(setting.repost_gap_days).toBe(EXPECTED_REPOST_GAP_DAYS);
  });

  // Criterion 94. Without a bar to clear, nothing could decide whether a
  // company's board joins a polling list.
  test("writes the promotion threshold", () => {
    expect(setting.promotion_threshold).toBe(EXPECTED_PROMOTION_THRESHOLD);
  });

  // Criteria 95 and 96. The guessed expiry is the shorter of the two, because
  // a guess is a placeholder rather than research.
  test("writes both score expiries", () => {
    expect(setting.score_expiry_days).toBe(EXPECTED_SCORE_EXPIRY_DAYS);
    expect(setting.guessed_score_expiry_days).toBe(EXPECTED_GUESSED_SCORE_EXPIRY_DAYS);
  });

});

describe("AC7: re-seeding never resets a setting that already has a value", () => {
  const myTerms = ["Staff Product Designer", "Design Systems"];

  // Deliberately none of the seeded defaults. A setting left at its default
  // survives a re-seed whether the seed overwrites it or not, so tuning these
  // away from 3, 1 and 12 is the only thing that makes the check below mean
  // anything.
  const myFastConcurrency = 5;
  const mySlowConcurrency = 2;
  const mySlowPauseSeconds = 30;
  const myRepostGapDays = 7;

  let dir: string;
  let setting: SettingRow;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-ac7-");
    dir = temp.dir;
    await runSql(temp.url, "UPDATE Setting SET search_terms = ? WHERE id = 1", [
      JSON.stringify(myTerms),
    ]);
    await runSql(
      temp.url,
      "UPDATE Setting SET resolution_fast_concurrency = ?, resolution_slow_concurrency = ?, resolution_slow_pause_seconds = ?, repost_gap_days = ? WHERE id = 1",
      [myFastConcurrency, mySlowConcurrency, mySlowPauseSeconds, myRepostGapDays]
    );
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

  // A source that pushes back is what these three exist to be slowed against,
  // so the user is expected to raise them. A re-seed overwriting the change
  // would undo that tuning every time.
  test("keeps the three lane settings I tuned", () => {
    expect(setting.resolution_fast_concurrency).toBe(myFastConcurrency);
    expect(setting.resolution_slow_concurrency).toBe(mySlowConcurrency);
    expect(setting.resolution_slow_pause_seconds).toBe(mySlowPauseSeconds);
  });

  // The gap is meant to be tuned against real runs, so a re-seed that reset it
  // would undo the tuning every time.
  test("keeps the repost gap I tuned", () => {
    expect(setting.repost_gap_days).toBe(myRepostGapDays);
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

describe("seeding writes no rows to the Trace table", () => {
  let dir: string;
  let url: string;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-trace-");
    dir = temp.dir;
    url = temp.url;
  }, SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("the Trace table is empty after seeding", async () => {
    const count = await countRows(url, "Trace");
    expect(count).toBe(0);
  });
});

// The title vocabularies are settings like any other: filled when absent,
// never overwritten. A vocabulary the user has edited is the case that
// matters, since an overwrite would silently undo their tuning.
describe("the title vocabularies are seeded and then left alone", () => {
  const myNouns = ["designer", "chef", "paralegal"];

  let dir: string;
  let seeded: SettingRow;
  let reseeded: SettingRow;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-vocabularies-");
    dir = temp.dir;
    seeded = await readSetting(temp.url);
    await runSql(temp.url, "UPDATE Setting SET title_head_nouns = ? WHERE id = 1", [
      JSON.stringify(myNouns),
    ]);
    runScript("db-seed.ts", temp.url);
    reseeded = await readSetting(temp.url);
  }, MULTI_SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("seeding a fresh database writes the head nouns", () => {
    expect(seeded.title_head_nouns).toContain("designer");
  });

  test("keeps the head nouns I changed", () => {
    expect(reseeded.title_head_nouns).toEqual(myNouns);
  });
});

// The source priority list is the one setting the fill-when-null pattern does
// not fit: it has to be read while it holds values and appended to. These
// blocks cover AC26 to AC30.
//
// EXPECTED_PRIORITY_LIST restates lib/collectors/registry.ts rather than
// importing it, the same way EXPECTED_TITLE_LEVELS restates the vocabularies.
// An independent copy is what proves the round trip through the database.
const EXPECTED_PRIORITY_LIST = [
  "collector:user",
  "parser:greenhouse",
  "parser:lever",
  "parser:ashby",
  "parser:dribbble",
  "parser:workday",
  "parser:ultipro",
  "parser:gem",
  "parser:smartrecruiters",
  "parser:bamboohr",
  "parser:rippling",
  "parser:workable",
  "collector:adzuna",
  "collector:jsearch",
  "collector:greenhouse",
  "collector:lever",
  "collector:ashby",
  "collector:dribbble",
  "collector:uiuxjobsboard",
  "collector:workday",
  "collector:ultipro",
  "collector:gem",
  "collector:smartrecruiters",
  "collector:bamboohr",
  "collector:rippling",
  "collector:workable",
  "collector:fantastic-jobs",
  "parser:general",
];

describe("AC26: seeding a fresh database builds the source priority list", () => {
  let dir: string;
  let setting: SettingRow;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-ac26-");
    dir = temp.dir;
    setting = await readSetting(temp.url);
  }, SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Decision of 2026-09-06: a job the user entered by hand wins every
  // contested field, which is what putting it at the top buys.
  test("collector:user sits first", () => {
    expect(setting.source_priority_list?.[0]).toBe("collector:user");
  });

  // The order is only where a fresh database starts; the user reorders it at
  // will. This checks that every registry name is present, not that the order
  // is right.
  test("every parser and collector in the registries follows it", () => {
    expect(setting.source_priority_list).toEqual(EXPECTED_PRIORITY_LIST);
  });

  // AC53. A parser read the employer's own posting, so where it disagrees
  // with an aggregator's copy of the same job the parser is the one telling
  // the truth. Only a job the user typed in by hand outranks it.
  // The general parser is the one exception: it reads what no dedicated
  // parser could, and joins the list last.
  test("every dedicated parser sits below collector:user and above every collector", () => {
    const list = setting.source_priority_list ?? [];
    const parserRanks = list
      .map((name, index) => ({ name, index }))
      .filter((entry) => entry.name.startsWith("parser:") && entry.name !== "parser:general")
      .map((entry) => entry.index);
    const collectorRanks = list
      .map((name, index) => ({ name, index }))
      .filter((entry) => entry.name.startsWith("collector:") && entry.name !== "collector:user")
      .map((entry) => entry.index);

    expect(parserRanks).toHaveLength(11);
    expect(Math.min(...parserRanks)).toBeGreaterThan(list.indexOf("collector:user"));
    expect(Math.max(...parserRanks)).toBeLessThan(Math.min(...collectorRanks));
  });
});

describe("AC27, AC28 and AC29: a second seed appends what is missing and moves nothing", () => {
  let dir: string;
  let output: string;
  let setting: SettingRow;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-ac27-");
    dir = temp.dir;
    // A hand-reordered list missing two collectors, so the run has something
    // to append and an order it must leave alone.
    await runSql(temp.url, "UPDATE Setting SET source_priority_list = ? WHERE id = 1", [
      JSON.stringify(["collector:greenhouse", "collector:user", "collector:adzuna"]),
    ]);
    output = runScriptForOutput("db-seed.ts", temp.url);
    setting = await readSetting(temp.url);
  }, MULTI_SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // AC27. The user reorders this list by hand, so a seed that sorted it would
  // undo their ranking on every run.
  test("the order the stored list already had is untouched", () => {
    expect(setting.source_priority_list?.slice(0, 3)).toEqual([
      "collector:greenhouse",
      "collector:user",
      "collector:adzuna",
    ]);
  });

  test("nothing that was stored is removed", () => {
    expect(setting.source_priority_list).toContain("collector:greenhouse");
    expect(setting.source_priority_list).toContain("collector:user");
    expect(setting.source_priority_list).toContain("collector:adzuna");
  });

  // AC28. Appending is what keeps a new collector ranked below every source
  // the user has already placed.
  test("every missing registry name is added below what was there", () => {
    expect(setting.source_priority_list).toEqual([
      "collector:greenhouse",
      "collector:user",
      "collector:adzuna",
      "parser:greenhouse",
      "parser:lever",
      "parser:ashby",
      "parser:dribbble",
      "parser:workday",
      "parser:ultipro",
      "parser:gem",
      "parser:smartrecruiters",
      "parser:bamboohr",
      "parser:rippling",
      "parser:workable",
      "collector:jsearch",
      "collector:lever",
      "collector:ashby",
      "collector:dribbble",
      "collector:uiuxjobsboard",
      "collector:workday",
      "collector:ultipro",
      "collector:gem",
      "collector:smartrecruiters",
      "collector:bamboohr",
      "collector:rippling",
      "collector:workable",
      "collector:fantastic-jobs",
      "parser:general",
    ]);
  });

  test("no name is added twice", () => {
    const list = setting.source_priority_list ?? [];
    expect(new Set(list).size).toBe(list.length);
  });

  // AC29. A source silently joining the ranking is a change to how every
  // contested field resolves, so the run says what it did.
  test("the run names each entry it added", () => {
    expect(output).toContain("collector:jsearch");
    expect(output).toContain("collector:uiuxjobsboard");
  });

  test("the run says where the entries went", () => {
    expect(output.toLowerCase()).toContain("bottom");
  });
});

describe("AC30: a list already holding every registry name is not written to", () => {
  let dir: string;
  let before: SettingRow;
  let after: SettingRow;
  let output: string;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-ac30-");
    dir = temp.dir;
    before = await readSetting(temp.url);
    output = runScriptForOutput("db-seed.ts", temp.url);
    after = await readSetting(temp.url);
  }, MULTI_SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // modified_at moves on any update, so a run that changed nothing must not
  // look like it did.
  test("the settings row is left untouched", () => {
    expect(after.modified_at).toBe(before.modified_at);
  });

  test("the list still reads exactly as it did", () => {
    expect(after.source_priority_list).toEqual(before.source_priority_list);
  });

  test("the run says it added nothing", () => {
    expect(output).toMatch(/priority/i);
    expect(output).not.toMatch(/added collector:/i);
  });
});

// UltiPro carries a job's only identity in its opportunityid query value, so a
// fresh database has to name it or two different UltiPro jobs match as one.
// Like every other setting it is filled only where it is missing: a list the
// user changed, an empty one included, is theirs.
describe("the identifying query values are seeded and then left alone", () => {
  let dir: string;
  let url: string;

  async function readIdentifying(): Promise<unknown> {
    const client = createClient({ url });
    try {
      const result = await client.execute(
        "SELECT identifying_query_values FROM Setting WHERE id = 1"
      );
      const raw = result.rows[0]?.["identifying_query_values"];
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } finally {
      client.close();
    }
  }

  beforeAll(() => {
    const temp = createAndSeed("pipeline-seed-identifying-");
    dir = temp.dir;
    url = temp.url;
  }, SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("seeding a fresh database names every job identifier a query value carries", async () => {
    expect(await readIdentifying()).toEqual(["opportunityid", "reqId", "gh_jid"]);
  });

  test(
    "a missing list is filled again",
    async () => {
      await runSql(url, "UPDATE Setting SET identifying_query_values = NULL WHERE id = 1");
      runScript("db-seed.ts", url);
      expect(await readIdentifying()).toEqual(["opportunityid", "reqId", "gh_jid"]);
    },
    SEED_TIMEOUT_MS
  );

  test(
    "a list I changed is kept",
    async () => {
      await runSql(url, "UPDATE Setting SET identifying_query_values = ? WHERE id = 1", [
        JSON.stringify(["opportunityid", "gh_jid"]),
      ]);
      runScript("db-seed.ts", url);
      expect(await readIdentifying()).toEqual(["opportunityid", "gh_jid"]);
    },
    SEED_TIMEOUT_MS
  );

  test(
    "a list I emptied is kept empty",
    async () => {
      await runSql(url, "UPDATE Setting SET identifying_query_values = '[]' WHERE id = 1");
      runScript("db-seed.ts", url);
      expect(await readIdentifying()).toEqual([]);
    },
    SEED_TIMEOUT_MS
  );
});

// The paid search's four settings start from the values the paid trial used.
// Like every other setting each is filled only where it is missing, so a list
// the user emptied, which switches a search off, stays empty.
describe("the search settings are seeded with their starting values", () => {
  let dir: string;
  let settings: Record<string, unknown>;

  const STARTING_TOWNS = [
    "Austin",
    "Round Rock",
    "Cedar Park",
    "Pflugerville",
    "Georgetown",
    "Leander",
    "Kyle",
    "Buda",
    "San Marcos",
    "Hutto",
    "Manor",
    "Lakeway",
    "Bee Cave",
    "Dripping Springs",
    "Taylor",
    "Bastrop",
  ].map((town) => `${town}, Texas, United States`);

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-seed-search-settings-");
    dir = temp.dir;
    const client = createClient({ url: temp.url });
    try {
      const result = await client.execute(
        "SELECT search_towns, remote_labels, excluded_titles, search_window_days FROM Setting WHERE id = 1"
      );
      const row = result.rows[0] as unknown as Record<string, unknown>;
      settings = Object.fromEntries(
        Object.entries(row).map(([column, raw]) => [
          column,
          typeof raw === "string" ? JSON.parse(raw) : Number(raw),
        ])
      );
    } finally {
      client.close();
    }
  }, SEED_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes the sixteen Austin-area towns", () => {
    expect(settings["search_towns"]).toEqual(STARTING_TOWNS);
  });

  test("writes the two remote labels", () => {
    expect(settings["remote_labels"]).toEqual(["Remote OK", "Remote Solely"]);
  });

  test("writes the titles to skip", () => {
    expect(settings["excluded_titles"]).toEqual([
      "Engineer",
      "Engineering",
      "Research",
      "Researcher",
      "Associate",
      "Junior",
      "Jr",
      "Intern",
      "Internship",
      "Director",
      "Head",
      "VP",
      "Manager",
    ]);
  });

  test("writes a seven-day window", () => {
    expect(settings["search_window_days"]).toBe(7);
  });
});
