// Flow test: An existing database is brought up to date for Fantastic.jobs.
//
// A database is built at the last migration before this feature's, holding a
// settings row the way the real one stood: a source ranking ordered by hand,
// and the identifying-values list holding only UltiPro's job number. Then the
// schema-change command runs, then the seed twice, with the town list emptied
// between the two. Last, the example settings file is read.
//
// Everything runs against a throwaway database, passing PIPELINE_DATABASE_URL
// in the environment, so the real pipeline.db is never touched.
//
// Covers: Keeps the other sources' order, Fills new settings in an existing
// database, Keeps a setting the user emptied, Ranks right after Workable,
// Backs up before reordering, Adds the job-number link parts, Lists the token
// in the example settings file.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Building the old database spawns the prisma CLI once per migration, and the
// schema-change command and two seeds follow. A ceiling rather than a budget:
// vitest runs these child processes in parallel and they contend for the
// machine.
const SETUP_TIMEOUT_MS = 300_000;

// The last migration before this feature's. The database starts here, so the
// feature's own migration is the one the schema-change command applies.
const LAST_MIGRATION_BEFORE_FEATURE = "20260923155709_add_identifying_query_values";

const ENTRY = "collector:fantastic-jobs";

// A ranking ordered by hand, as the real one is: every parser, then the
// collectors that poll boards, then the scraping and API collectors.
const RANKING_BEFORE = [
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
  "parser:general",
  "collector:greenhouse",
  "collector:lever",
  "collector:ashby",
  "collector:workday",
  "collector:ultipro",
  "collector:gem",
  "collector:smartrecruiters",
  "collector:bamboohr",
  "collector:rippling",
  "collector:workable",
  "collector:uiuxjobsboard",
  "collector:dribbble",
  "collector:adzuna",
  "collector:jsearch",
];

const IDENTIFYING_BEFORE = ["opportunityid"];

// The starting values the seed gives each new setting, taken from the paid
// trial.
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
const STARTING_REMOTE_LABELS = ["Remote OK", "Remote Solely"];
const STARTING_EXCLUDED_TITLES = [
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
];
const STARTING_WINDOW_DAYS = 7;

// The new settings, by the column each is stored in.
const NEW_SETTINGS = {
  search_towns: STARTING_TOWNS,
  remote_labels: STARTING_REMOTE_LABELS,
  excluded_titles: STARTING_EXCLUDED_TITLES,
  search_window_days: STARTING_WINDOW_DAYS,
};

type SettingsRow = Record<string, unknown>;

// A Json column comes back as its text, and an integer column as a number.
function valueOf(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

async function readSettings(url: string): Promise<SettingsRow> {
  const client = createClient({ url });
  try {
    const result = await client.execute("SELECT * FROM Setting WHERE id = 1");
    const row = result.rows[0];
    if (!row) throw new Error(`no settings row in ${url}`);
    return Object.fromEntries(result.columns.map((column) => [column, valueOf(row[column])]));
  } finally {
    client.close();
  }
}

function run(command: string[], url: string): void {
  execFileSync("npx", command, {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

const listOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => String(entry)) : [];

describe("An existing database is brought up to date for Fantastic.jobs", () => {
  let dir: string;
  let url: string;
  let afterMigrate: SettingsRow;
  let afterFirstSeed: SettingsRow;
  let afterSecondSeed: SettingsRow;
  let backups: string[];
  let backedUp: SettingsRow | null = null;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "fantastic-jobs-setup-flow-"));
    url = `file:${join(dir, "pipeline.db")}`;

    // The database as it stood before this feature: every earlier migration
    // applied, and recorded as applied, so the schema-change command treats the
    // feature's migration as the one still to run.
    const migrationsDir = join(repoRoot, "prisma", "migrations");
    const earlier = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name <= LAST_MIGRATION_BEFORE_FEATURE)
      .map((entry) => entry.name)
      .sort();
    const client = createClient({ url });
    try {
      for (const name of earlier) {
        await client.executeMultiple(readFileSync(join(migrationsDir, name, "migration.sql"), "utf8"));
      }
      await client.execute({
        sql: "INSERT INTO Setting (id, search_terms, source_priority_list, identifying_query_values, modified_at) VALUES (1, ?, ?, ?, ?)",
        args: [
          JSON.stringify(["Product Design"]),
          JSON.stringify(RANKING_BEFORE),
          JSON.stringify(IDENTIFYING_BEFORE),
          "2026-10-01T00:00:00.000Z",
        ],
      });
    } finally {
      client.close();
    }
    for (const name of earlier) run(["prisma", "migrate", "resolve", "--applied", name], url);

    run(["tsx", "scripts/db-migrate.ts"], url);
    afterMigrate = await readSettings(url);
    backups = readdirSync(dir).filter((name) => name.includes("backup"));
    if (backups[0]) backedUp = await readSettings(`file:${join(dir, backups[0])}`);

    run(["tsx", "scripts/db-seed.ts"], url);
    afterFirstSeed = await readSettings(url);

    const emptier = createClient({ url });
    try {
      await emptier.execute("UPDATE Setting SET search_towns = '[]' WHERE id = 1");
    } finally {
      emptier.close();
    }
    run(["tsx", "scripts/db-seed.ts"], url);
    afterSecondSeed = await readSettings(url);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("Keeps the other sources' order", () => {
    const ranking = listOf(afterMigrate["source_priority_list"]);
    expect(ranking).toContain(ENTRY);
    expect(ranking.filter((source) => source !== ENTRY)).toEqual(RANKING_BEFORE);
  });

  test("Fills new settings in an existing database", () => {
    for (const [column, starting] of Object.entries(NEW_SETTINGS)) {
      expect(afterFirstSeed[column]).toEqual(starting);
    }
  });

  test("Keeps a setting the user emptied", () => {
    expect(afterSecondSeed["search_towns"]).toEqual([]);
  });

  test("Ranks right after Workable", () => {
    const ranking = listOf(afterFirstSeed["source_priority_list"]);
    expect(ranking.indexOf(ENTRY)).toBe(ranking.indexOf("collector:workable") + 1);
    expect(ranking.filter((source) => source === ENTRY)).toHaveLength(1);
  });

  test("Backs up before reordering", () => {
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/\d{4}-\d{2}-\d{2}/);
    // The copy holds the ranking and link parts from before the change.
    expect(listOf(backedUp?.["source_priority_list"])).toEqual(RANKING_BEFORE);
    expect(listOf(backedUp?.["identifying_query_values"])).toEqual(IDENTIFYING_BEFORE);
  });

  test("Adds the job-number link parts", () => {
    expect(listOf(afterMigrate["identifying_query_values"])).toEqual(
      expect.arrayContaining([...IDENTIFYING_BEFORE, "reqId", "gh_jid"])
    );
  });

  test("Lists the token in the example settings file", () => {
    const example = readFileSync(join(repoRoot, ".env.example"), "utf8");
    expect(example).toMatch(/^FANTASTIC_JOBS_APIFY_TOKEN=/m);
  });
});
