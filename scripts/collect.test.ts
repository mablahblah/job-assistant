import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Creating and seeding each measured well under two seconds, and the registry
// is empty so the collect run has nothing to poll. This is a ceiling for all
// three steps together rather than a budget, generous because each spawns
// npx tsx in turn.
const SETUP_TIMEOUT_MS = 120_000;

interface SettingRow {
  search_terms: string[] | null;
  location: string | null;
  radius: number | null;
  expiry_threshold: number | null;
  modified_at: string;
}

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

// Runs a real script against a scratch database. The url travels in the
// environment because dotenv never overwrites a variable already set, so this
// value wins over the repo's .env and the live pipeline.db is never touched.
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

interface CollectResult {
  status: number | null;
  stderr: string;
}

// Run with spawnSync rather than execFileSync, so a non-zero exit is a result
// to inspect rather than a throw that skips the rest of the suite.
function runCollect(url: string): CollectResult {
  // --limit 0 keeps the suite off the network: the wiring runs end to end and
  // no collector is asked for anything.
  const result = spawnSync("npx", ["tsx", "scripts/collect.ts", "--limit", "0"], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
}

async function countRows(url: string, table: string): Promise<number> {
  const client = createClient({ url });
  try {
    const result = await client.execute(`SELECT count(*) as count FROM ${table}`);
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
    if (!row) throw new Error(`no rows back counting ${table}`);
    return Number(row["count"]);
  } finally {
    client.close();
  }
}

// modified_at carries @updatedAt in the schema, so it moves on any write, even
// one that stores the same values back. Reading the whole row catches a
// changed value as well as a write that changed nothing.
async function readSetting(url: string): Promise<SettingRow> {
  const client = createClient({ url });
  try {
    const result = await client.execute("SELECT * FROM Setting WHERE id = 1");
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
    if (!row) throw new Error("Setting row is missing");
    // search_terms is a Json column, which comes back through raw sql as text
    // holding json rather than as an array.
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

// The registry is empty, so this pins down the wiring rather than what gets
// collected: a real database in, settings read but never written, and nothing
// saved, because saving belongs to a later phase.
describe("AC 14: the collect command runs collection and writes nothing", () => {
  let dir: string;
  let result: CollectResult;
  let jobCount: number;
  let settingsBefore: SettingRow;
  let settingsAfter: SettingRow;
  let entriesAfter: string[];

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-collect-");
    dir = temp.dir;

    settingsBefore = await readSetting(temp.url);
    result = runCollect(temp.url);
    jobCount = await countRows(temp.url, "Job");
    settingsAfter = await readSetting(temp.url);
    entriesAfter = readdirSync(dir);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("exits successfully against a freshly created and seeded database", () => {
    // The exit status alone leaves a broken command silent about why, so the
    // command's own stderr rides along in the failure message.
    expect(result.status, `collect.ts failed:\n${result.stderr}`).toBe(0);
  });

  test("writes no Job rows, because collection stops at a job list in memory", () => {
    expect(jobCount).toBe(0);
  });

  test("leaves the seeded settings unchanged, because the command only reads them", () => {
    expect(settingsAfter).toEqual(settingsBefore);
  });

  test("creates no database of its own beside the temp one", () => {
    // A command that missed PIPELINE_DATABASE_URL would either throw, which
    // the exit-status test catches, or write to a second file. Matching on the
    // prefix leaves room for the journal files SQLite writes beside the db.
    for (const entry of entriesAfter) {
      expect(entry.startsWith("pipeline.db")).toBe(true);
    }
  });
});
