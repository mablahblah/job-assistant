import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Creating, seeding and resetting measured well under two seconds each. This
// is a ceiling rather than a budget: the setup runs all three in a row.
const SETUP_TIMEOUT_MS = 120_000;

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

// Every column of the settings row, read as plain values so two reads can be
// compared directly.
async function readSettingRow(url: string): Promise<Record<string, unknown>> {
  const client = createClient({ url });
  try {
    const result = await client.execute("SELECT * FROM Setting WHERE id = 1");
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
    if (!row) throw new Error("Setting row is missing");
    return { ...row };
  } finally {
    client.close();
  }
}

// The tables the schema defines, so a reset that dropped one is visible.
// sqlite_sequence is sqlite's own bookkeeping and is left out.
async function readTableNames(url: string): Promise<string[]> {
  const client = createClient({ url });
  try {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    return result.rows.map((row) => String((row as unknown as Record<string, unknown>)["name"]))
      .sort();
  } finally {
    client.close();
  }
}

// Every company left standing, paired with the board slug naming it, where a
// slug row names it at all. A company no row names is run output.
async function readCompanyBoards(url: string): Promise<Array<string | null>> {
  const client = createClient({ url });
  try {
    const result = await client.execute(
      "SELECT AtsSlug.slug AS slug FROM Company LEFT JOIN AtsSlug ON AtsSlug.company_id = Company.id"
    );
    return result.rows.map((row) => {
      const value = (row as unknown as Record<string, unknown>)["slug"];
      return value === null || value === undefined ? null : String(value);
    });
  } finally {
    client.close();
  }
}

describe("db-reset", () => {
  let temp: { dir: string; url: string };
  let settingBefore: Record<string, unknown>;
  let settingAfter: Record<string, unknown>;
  let tablesBefore: string[];
  let tablesAfter: string[];
  let seededSlugCount = 0;

  beforeAll(async () => {
    temp = makeTempDb("db-reset-");
    runScript("db-create.ts", temp.url);
    // The seed supplies the settings row, which the reset has to leave alone.
    runScript("db-seed.ts", temp.url);

    // The seed no longer creates board rows, so the configuration company the
    // reset must spare is written here the way promotion would write it.
    await runSql(
      temp.url,
      `INSERT INTO Company (id, name, match_key, modified_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      ["company-board", "Polled Employer", "polledemployer"]
    );
    await runSql(
      temp.url,
      `INSERT INTO AtsSlug (id, slug, company_id, parser, collector, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ["board-row", "polledemployer", "company-board", "greenhouse", "greenhouse"]
    );

    seededSlugCount = await countRows(temp.url, "AtsSlug");

    // A company met during a run rather than seeded: no slug row names it,
    // which is what makes it run output.
    await runSql(
      temp.url,
      `INSERT INTO Company (id, name, match_key, modified_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      ["company-collected", "Collected Employer", "collectedemployer"]
    );

    await runSql(
      temp.url,
      `INSERT INTO Job (id, company_id, raw_title, title, collector, collected_at, modified_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ["job-one", "company-collected", "Senior UX Designer", "Sr. UX Designer", "adzuna"]
    );

    await runSql(
      temp.url,
      `INSERT INTO Trace (run_id, job_id, step, event, collector)
       VALUES (?, ?, ?, ?, ?)`,
      ["run-one", "job-one", "collection", "job_collected", "adzuna"]
    );

    settingBefore = await readSettingRow(temp.url);
    tablesBefore = await readTableNames(temp.url);

    runScript("db-reset.ts", temp.url);

    settingAfter = await readSettingRow(temp.url);
    tablesAfter = await readTableNames(temp.url);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    if (temp) rmSync(temp.dir, { recursive: true, force: true });
  });

  // Criterion 71.
  test("every job is gone", async () => {
    expect(await countRows(temp.url, "Job")).toBe(0);
  });

  // Criterion 71.
  test("every trace row is gone", async () => {
    expect(await countRows(temp.url, "Trace")).toBe(0);
  });

  // Criterion 51. A company a slug row names is a board the pipeline knows
  // about, which is configuration rather than run output.
  test("a company a slug row names survives", async () => {
    const slugs = await readCompanyBoards(temp.url);
    expect(seededSlugCount).toBeGreaterThan(0);
    expect(slugs.filter((slug) => slug !== null)).toHaveLength(seededSlugCount);
  });

  test("a company no slug row names is deleted", async () => {
    const slugs = await readCompanyBoards(temp.url);
    expect(slugs.filter((slug) => slug === null)).toHaveLength(0);
  });

  // The rows themselves are configuration too. A company kept without its row
  // would be an orphan nothing could poll.
  test("every slug row survives", async () => {
    expect(await countRows(temp.url, "AtsSlug")).toBe(seededSlugCount);
  });

  // Criterion 74.
  test("the settings row survives untouched", () => {
    expect(settingAfter).toEqual(settingBefore);
  });

  // Criterion 75.
  test("no table was dropped", () => {
    expect(tablesAfter).toEqual(tablesBefore);
    expect(tablesBefore).toEqual([
      "AtsSlug",
      "Company",
      "Job",
      "Place",
      "Setting",
      "Trace",
      "WorkLogEntry",
    ]);
  });
});
