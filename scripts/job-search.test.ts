import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Creating and seeding each measured well under two seconds, and the registry
// is empty so the job-search run has nothing to poll. This is a ceiling for all
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
  // db-create takes its target as an argument and refuses to run without
  // one; every other script still reads the url from the environment.
  const args = script === "db-create.ts" ? [url] : [];
  execFileSync("npx", ["tsx", `scripts/${script}`, ...args], {
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

interface RunResult {
  status: number | null;
  stderr: string;
  // The trace-failure line, when there is one, goes to stdout alongside the
  // job list, the same place printIssues writes.
  stdout: string;
}

// Run with spawnSync rather than execFileSync, so a non-zero exit is a result
// to inspect rather than a throw that skips the rest of the suite.
function runJobSearch(url: string): RunResult {
  // --limit 0 keeps the suite off the network: the wiring runs end to end and
  // no collector is asked for anything.
  const result = spawnSync("npx", ["tsx", "scripts/job-search.ts", "--limit", "0"], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
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
describe("AC 11: the job-search command runs the pipeline and reaches no source", () => {
  let dir: string;
  let result: RunResult;
  let jobCount: number;
  let traceCount: number;
  let settingsBefore: SettingRow;
  let settingsAfter: SettingRow;
  let entriesAfter: string[];

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-job-search-");
    dir = temp.dir;

    settingsBefore = await readSetting(temp.url);
    result = runJobSearch(temp.url);
    jobCount = await countRows(temp.url, "Job");
    traceCount = await countRows(temp.url, "Trace");
    settingsAfter = await readSetting(temp.url);
    entriesAfter = readdirSync(dir);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("exits successfully against a freshly created and seeded database", () => {
    // The exit status alone leaves a broken command silent about why, so the
    // command's own stderr rides along in the failure message.
    expect(result.status, `job-search.ts failed:\n${result.stderr}`).toBe(0);
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

  // AC 16/37 of the Phase 2 spec: a --limit 0 run reaches no source and loses
  // no trace writes, so it is the clean case for both criteria at once. This
  // reuses the database above rather than spinning up a second one, since a
  // clean run is exactly what that beforeAll already produced.
  describe("what a clean run reports and writes about tracing", () => {
    test("prints no trace failure line, because nothing failed", () => {
      expect(result.stdout).not.toMatch(/Trace failures:/);
    });

    test("leaves the Trace table empty, because no source was reached", () => {
      expect(traceCount).toBe(0);
    });
  });
});

// AC 18/19 of the Phase 2 spec: a job search mints a run id, as a
// crypto.randomUUID(), so every trace event it produces can be told apart from
// another search's events. --limit 0 returns before any trace event exists, so
// a minted run id leaves nothing to observe in the database or on stdout — the
// only evidence available is the script's own text.
describe("the job-search command mints a run id", () => {
  const source = readFileSync(join(repoRoot, "scripts", "job-search.ts"), "utf-8");

  test("calls crypto.randomUUID()", () => {
    expect(source).toMatch(/crypto\.randomUUID\(\)/);
  });

  test("passes the minted run id into runJobSearch", () => {
    // Finds whatever name the script gave the minted id, rather than assuming
    // one, then checks that same name reaches the call.
    const mintedName = source.match(
      /\b(?:const|let)\s+(\w+)\s*=\s*crypto\.randomUUID\(\)/
    )?.[1];
    expect(mintedName, "expected a variable assigned from crypto.randomUUID()").toBeTruthy();

    const call = source.match(/runJobSearch\(\{[\s\S]*?\}\)/);
    expect(call, "expected a call to runJobSearch({ ... })").toBeTruthy();

    // The name has to appear as its own token in the call, not as part of some
    // other identifier.
    expect(call?.[0]).toMatch(new RegExp(`\\b${mintedName}\\b`));
  });
});

// AC 13 and the summary the user reads. A --limit 0 run reaches no source, so
// every number is zero — which is exactly what makes the shape of the summary
// checkable without touching a job site.
describe("what a finished run prints", () => {
  let dir: string;
  let result: RunResult;

  beforeAll(() => {
    const temp = createAndSeed("pipeline-job-search-summary-");
    dir = temp.dir;
    result = runJobSearch(temp.url);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("the headline numbers are printed even when they are zero", () => {
    expect(result.stdout, result.stderr).toContain("Collected: 0 jobs");
    expect(result.stdout).toContain("Resolved: 0 jobs");
  });

  test("every collector is named, so a source that went quiet is visible", () => {
    for (const name of ["adzuna", "jsearch", "greenhouse", "lever", "ashby", "dribbble", "uiuxjobsboard"]) {
      expect(result.stdout).toContain(`  - ${name} collected 0 jobs`);
    }
  });

  test("a detail line with nothing to report is left out", () => {
    expect(result.stdout).not.toContain("could not be resolved");
    expect(result.stdout).not.toContain("Dedupe (post collection)");
  });

  test("a run where nothing threw says nothing about a failure", () => {
    expect(result.stdout).not.toContain("Run stopped");
    expect(result.stderr).not.toContain("Run stopped");
  });
});

// AC 12. The command is named after the pipeline rather than after its first
// step, so the script the package exposes has to move with it.
describe("AC 12: package.json exposes job-search and no longer exposes collect", () => {
  const scripts = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
    scripts: Record<string, string>;
  };

  test("job-search is present", () => {
    expect(scripts.scripts["job-search"]).toBeDefined();
  });

  test("collect is gone", () => {
    expect(scripts.scripts["collect"]).toBeUndefined();
  });
});

// Phase 8b, AC 14, 15, 16. The fault this guards against happened for real: a
// column added to the schema was never pushed to the live database, so every
// trace write of that run failed silently and a whole run's history was lost.
// Dropping that same column back off a seeded database reproduces it exactly.
describe("phase 8b AC 14, 15, 16: a database that does not match the code stops the run", () => {
  let dir: string;
  let result: RunResult;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-job-search-drift-");
    dir = temp.dir;

    const client = createClient({ url: temp.url });
    try {
      await client.execute("ALTER TABLE Trace DROP COLUMN domain");
    } finally {
      client.close();
    }

    result = runJobSearch(temp.url);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // AC 15. Both halves matter: which table is wrong, and what to type next.
  test("names the table it could not read", () => {
    expect(result.stdout).toContain("Trace");
  });

  // Phase 13 reworded the advice: after the switch over a rebuild destroys
  // real records, so the message names the safe migration command instead.
  test("names the command that migrates the database", () => {
    expect(result.stdout).toContain("npm run db:migrate");
  });

  // AC 16. A run that recorded nothing must not look like a run that worked.
  test("exits with a code that is not zero", () => {
    expect(result.status).not.toBe(0);
  });

  // AC 14. runJobSearch is handed createResolutionBrowser and is the only
  // thing that ever calls it, so a run that never reached runJobSearch never
  // launched a browser. What proves it was never reached is the absence of
  // the lines printed from its report the moment it returns.
  test("stops before the pipeline runs, so nothing launches a browser", () => {
    expect(result.stdout).not.toContain("Errors:");
    expect(result.stdout).not.toContain("Warnings:");
  });
});
