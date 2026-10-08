// The add-external-jobs command's own two jobs: printing the run identifier
// before anything else, and exiting with a failure when the run stopped. What
// the run does to each link is proved by the runner's flow tests, which call
// it directly with stand-in websites; this test hands the command an empty
// list, so the wiring runs end to end and no website is reached.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Creating, seeding and the run each spawn npx tsx. A ceiling rather than a
// budget.
const SETUP_TIMEOUT_MS = 120_000;

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

// The url travels in the environment because dotenv never overwrites a
// variable already set, so the live pipeline.db is never touched.
function runScript(script: string, url: string): void {
  const args = script === "db-create.ts" ? [url] : [];
  execFileSync("npx", ["tsx", `scripts/${script}`, ...args], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

function createAndSeed(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const url = `file:${join(dir, "pipeline.db")}`;
  runScript("db-create.ts", url);
  runScript("db-seed.ts", url);
  return { dir, url };
}

// Run with spawnSync rather than execFileSync, so a non-zero exit is a result
// to inspect rather than a throw.
function runAddExternalJobs(dir: string, url: string): RunResult {
  const submissions = join(dir, "submissions.json");
  writeFileSync(submissions, "[]");
  const result = spawnSync("npx", ["tsx", "scripts/add-external-jobs.ts", "--in", submissions], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("a run that finishes", () => {
  let dir: string;
  let result: RunResult;

  beforeAll(() => {
    const temp = createAndSeed("pipeline-add-external-jobs-");
    dir = temp.dir;
    result = runAddExternalJobs(dir, temp.url);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("exits successfully", () => {
    expect(result.status, `add-external-jobs.ts failed:\n${result.stderr}`).toBe(0);
  });

  // The scoring skill reads this line to file its own records under the same
  // run, so it has to come before anything else.
  test("the first line printed is the run identifier", () => {
    expect(result.stdout.split("\n")[0]).toMatch(/^Run: [0-9a-f-]{36}$/);
  });
});

describe("a run that stops", () => {
  let dir: string;
  let result: RunResult;

  beforeAll(async () => {
    const temp = createAndSeed("pipeline-add-external-jobs-stopped-");
    dir = temp.dir;

    // With no home location the run cannot judge any job's location, so it
    // stops at that step.
    const client = createClient({ url: temp.url });
    try {
      await client.execute("UPDATE Setting SET location = NULL WHERE id = 1");
    } finally {
      client.close();
    }

    result = runAddExternalJobs(dir, temp.url);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("exits with a failure", () => {
    expect(result.status).not.toBe(0);
  });

  test("still prints the run identifier first", () => {
    expect(result.stdout.split("\n")[0]).toMatch(/^Run: [0-9a-f-]{36}$/);
  });
});
