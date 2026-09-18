import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Three spawns of npx tsx in turn, each measured well under two seconds. A
// ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

// The url travels in the environment because dotenv never overwrites a
// variable already set, so this value wins over the repo's .env and the live
// pipeline.db is never touched.
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

interface RunResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

// spawnSync rather than execFileSync, so a non-zero exit is a result to
// inspect rather than a throw that skips the rest of the suite.
function runGather(url: string, args: string[]): RunResult {
  const result = spawnSync("npx", ["tsx", "scripts/score-gather.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

interface GatheredWork {
  runId: string;
  jobs: unknown[];
  companies: unknown[];
  warnings: unknown[];
  failure: unknown;
}

// A database created and seeded but never collected into holds nothing to
// score, which is what pins down the wiring rather than the scoring itself.
describe("the score-gather command against an empty backlog", () => {
  let dir: string;
  let result: RunResult;
  let work: GatheredWork;

  beforeAll(() => {
    const temp = makeTempDb("pipeline-score-gather-");
    dir = temp.dir;
    runScript("db-create.ts", temp.url);
    runScript("db-seed.ts", temp.url);

    const out = join(dir, "work.json");
    result = runGather(temp.url, ["--out", out, "--run-id", "test-run"]);
    work = JSON.parse(readFileSync(out, "utf8")) as GatheredWork;
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("exits successfully", () => {
    // The exit status alone leaves a broken command silent about why, so the
    // command's own stderr rides along in the failure message.
    expect(result.status, result.stderr).toBe(0);
  });

  test("writes the run identifier it was handed", () => {
    expect(work.runId).toBe("test-run");
  });

  test("writes an empty list of jobs and an empty list of companies", () => {
    expect(work.jobs).toEqual([]);
    expect(work.companies).toEqual([]);
  });

  test("reports no failure", () => {
    expect(work.failure).toBeNull();
  });

  // Phase 13 criterion "A stranger identifier draws a warning". "test-run"
  // was handed in and no trace rows carry it, so the command says so rather
  // than silently filing this scoring under a run that never happened.
  test("warns that the handed identifier matches no trace rows", () => {
    expect(result.stdout).toContain('run identifier "test-run" matches no trace rows');
  });
});

// A minted identifier never matches existing trace rows either, but nobody
// handed it over, so there is no mistake to warn about.
describe("the score-gather command minting its own run identifier", () => {
  let dir: string;
  let result: RunResult;

  beforeAll(() => {
    const temp = makeTempDb("pipeline-score-gather-minted-");
    dir = temp.dir;
    runScript("db-create.ts", temp.url);
    runScript("db-seed.ts", temp.url);

    result = runGather(temp.url, ["--out", join(dir, "work.json")]);
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("exits successfully and draws no stranger warning", () => {
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("matches no trace rows");
  });
});

describe("the score-gather command without a destination", () => {
  test("refuses to run and says so", () => {
    const temp = makeTempDb("pipeline-score-gather-noout-");
    try {
      const result = runGather(temp.url, []);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--out");
    } finally {
      rmSync(temp.dir, { recursive: true, force: true });
    }
  });
});
