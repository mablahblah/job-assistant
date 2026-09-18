import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Several spawns of npx tsx in turn, each measured well under two seconds. A
// ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

// Each test here spawns npx tsx, which costs a few seconds before the command
// itself starts. Vitest's own five-second default is below that floor, so
// every spawning test names its own ceiling.
const RUN_TIMEOUT_MS = 60_000;

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

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
  stdout: string;
  stderr: string;
}

function runFind(url: string, args: string[]): RunResult {
  const result = spawnSync("npx", ["tsx", "scripts/find-jobs.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function run(url: string, sql: string): Promise<void> {
  const client = createClient({ url });
  try {
    await client.execute(sql);
  } finally {
    client.close();
  }
}

let dir: string;
let url: string;

beforeAll(async () => {
  const temp = makeTempDb("pipeline-find-jobs-");
  dir = temp.dir;
  url = temp.url;
  runScript("db-create.ts", url);
  runScript("db-seed.ts", url);

  await run(
    url,
    `INSERT INTO Company (id, name, match_key, created_at, modified_at)
     VALUES ('co-figma', 'Figma', 'figma', '2026-01-01', '2026-01-01')`
  );
  await run(
    url,
    `INSERT INTO Company (id, name, match_key, created_at, modified_at)
     VALUES ('co-canva', 'Canva', 'canva', '2026-01-01', '2026-01-01')`
  );

  // Two Figma jobs a month apart, so the ordering has something to order, and
  // one of them sits in an active status so the status filter has something
  // to leave out.
  await run(
    url,
    `INSERT INTO Job (id, company_id, title, status, posting_date, collected_at,
                      created_at, modified_at, is_resolved, is_parsed, is_classified)
     VALUES ('job-older', 'co-figma', 'Senior Product Designer', 'backlog',
             '2026-01-01', '2026-01-01', '2026-01-01', '2026-01-01', 1, 1, 1)`
  );
  await run(
    url,
    `INSERT INTO Job (id, company_id, title, status, posting_date, collected_at,
                      created_at, modified_at, is_resolved, is_parsed, is_classified,
                      original_url, resolved_url, location_match_place)
     VALUES ('job-newer', 'co-figma', 'Staff Product Engineer', 'app. sent',
             '2026-02-01', '2026-01-01', '2026-01-01', '2026-01-01', 1, 1, 1,
             'https://aggregator.example.com/jobs/9', 'https://boards.example.com/figma/9',
             'Austin, TX')`
  );
  await run(
    url,
    `INSERT INTO Job (id, company_id, title, status, posting_date, collected_at,
                      created_at, modified_at, is_resolved, is_parsed, is_classified)
     VALUES ('job-canva', 'co-canva', 'Product Designer', 'backlog',
             '2026-03-01', '2026-01-01', '2026-01-01', '2026-01-01', 1, 1, 1)`
  );
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("searching for a job", () => {
  // AC 92. The skill turns these words back into a job id, and the user reads
  // the same line to check the skill picked the job they meant.
  test(
    "names each match's id, title, employer and status",
    () => {
      const result = runFind(url, ["--company", "canva"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("job-canva");
      expect(result.stdout).toContain("Product Designer");
      expect(result.stdout).toContain("Canva");
      expect(result.stdout).toContain("backlog");
    },
    RUN_TIMEOUT_MS
  );

  // AC 91.
  test(
    "puts the most recently published match first",
    () => {
      const result = runFind(url, ["--company", "figma"]);

      expect(result.status).toBe(0);
      expect(result.stdout.indexOf("job-newer")).toBeLessThan(result.stdout.indexOf("job-older"));
    },
    RUN_TIMEOUT_MS
  );

  // AC 88.
  test(
    "keeps only the matches whose title holds the title part",
    () => {
      const result = runFind(url, ["--company", "figma", "--title", "engineer"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("job-newer");
      expect(result.stdout).not.toContain("job-older");
    },
    RUN_TIMEOUT_MS
  );

  // AC 101. This is what lets the skill search backlog jobs alone when the
  // status being set is app. sent.
  test(
    "keeps only the matches holding one of the statuses it was handed",
    () => {
      const result = runFind(url, ["--company", "figma", "--statuses", "backlog"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("job-older");
      expect(result.stdout).not.toContain("job-newer");
    },
    RUN_TIMEOUT_MS
  );

  // AC 90. The skill tells this apart from a list of matches, so the sentence
  // is a fixed value rather than a label anyone may reword.
  test(
    "states that nothing matched where no employer name holds that part",
    () => {
      const result = runFind(url, ["--company", "nobody-by-that-name"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("no job matched");
    },
    RUN_TIMEOUT_MS
  );

  test(
    "refuses a run naming no employer",
    () => {
      const result = runFind(url, []);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--company");
    },
    RUN_TIMEOUT_MS
  );
});

// Phase 13, criteria "A machine-readable answer exists", "The answer names
// the job", "The answer carries both links", and "The answer carries the
// location". The resume skill parses this answer instead of the printed
// lines, so it is structured data on stdout and nothing else.
describe("the machine-readable answer", () => {
  function parseJson(stdout: string): Array<Record<string, unknown>> {
    return JSON.parse(stdout) as Array<Record<string, unknown>>;
  }

  test("the answer parses as structured data", () => {
    const result = runFind(url, ["--company", "figma", "--json"]);

    expect(result.status).toBe(0);
    const matches = parseJson(result.stdout);
    expect(Array.isArray(matches)).toBe(true);
    expect(matches).toHaveLength(2);
  }, RUN_TIMEOUT_MS);

  test("a match carries the fields the printed lines already show", () => {
    const result = runFind(url, ["--company", "figma", "--json"]);
    const match = parseJson(result.stdout).find((row) => row["id"] === "job-newer");

    expect(match?.["title"]).toBe("Staff Product Engineer");
    expect(match?.["company_name"]).toBe("Figma");
    expect(match?.["status"]).toBe("app. sent");
    expect(String(match?.["posting_date"])).toContain("2026-02-01");
  }, RUN_TIMEOUT_MS);

  test("a match carries the collected link, the source posting's link, and the location", () => {
    const result = runFind(url, ["--company", "figma", "--json"]);
    const match = parseJson(result.stdout).find((row) => row["id"] === "job-newer");

    expect(match?.["original_url"]).toBe("https://aggregator.example.com/jobs/9");
    expect(match?.["resolved_url"]).toBe("https://boards.example.com/figma/9");
    expect(match?.["location"]).toBe("Austin, TX");
  }, RUN_TIMEOUT_MS);

  test("no match is an empty list, not prose", () => {
    const result = runFind(url, ["--company", "nothing-holds-this", "--json"]);

    expect(result.status).toBe(0);
    expect(parseJson(result.stdout)).toEqual([]);
  }, RUN_TIMEOUT_MS);
});
