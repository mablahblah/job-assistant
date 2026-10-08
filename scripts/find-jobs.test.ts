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

// The one answer the command gives: an object naming which search found the
// jobs, any problem with the link, and the jobs. Both the resume skill and
// the status skill read it, so it is structured data on stdout and nothing
// else. The link search and the fall back to the employer are walked through
// by the two flow tests beside this file.
interface Answer {
  found_by: string;
  link_problem: string | null;
  jobs: Array<Record<string, unknown>>;
}

function answerOf(result: RunResult): Answer {
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Answer;
}

describe("searching by employer", () => {
  // AC 92. The skill turns these fields back into a job id, and the user reads
  // them to check the skill picked the job they meant.
  test(
    "names each match's id, title, employer, status and posting date",
    () => {
      const answer = answerOf(runFind(url, ["--company", "figma"]));
      const match = answer.jobs.find((job) => job["id"] === "job-newer");

      expect(match?.["title"]).toBe("Staff Product Engineer");
      expect(match?.["company_name"]).toBe("Figma");
      expect(match?.["status"]).toBe("app. sent");
      expect(String(match?.["posting_date"])).toContain("2026-02-01");
    },
    RUN_TIMEOUT_MS
  );

  // The resume skill fetches the posting by these links and tailors to the
  // location.
  test(
    "a match carries the collected link, the source posting's link, and the location",
    () => {
      const answer = answerOf(runFind(url, ["--company", "figma"]));
      const match = answer.jobs.find((job) => job["id"] === "job-newer");

      expect(match?.["original_url"]).toBe("https://aggregator.example.com/jobs/9");
      expect(match?.["resolved_url"]).toBe("https://boards.example.com/figma/9");
      expect(match?.["location"]).toBe("Austin, TX");
    },
    RUN_TIMEOUT_MS
  );

  // AC 91.
  test(
    "puts the most recently published match first",
    () => {
      const answer = answerOf(runFind(url, ["--company", "figma"]));

      expect(answer.jobs.map((job) => job["id"])).toEqual(["job-newer", "job-older"]);
    },
    RUN_TIMEOUT_MS
  );

  // AC 101. This is what lets the skill search backlog jobs alone when the
  // status being set is app. sent.
  test(
    "keeps only the matches holding one of the statuses it was handed",
    () => {
      const answer = answerOf(runFind(url, ["--company", "figma", "--statuses", "backlog"]));

      expect(answer.jobs.map((job) => job["id"])).toEqual(["job-older"]);
    },
    RUN_TIMEOUT_MS
  );

  // A trailing comma must not become a status nothing can hold.
  test(
    "a status list with stray commas and spaces narrows the same way",
    () => {
      const answer = answerOf(runFind(url, ["--company", "figma", "--statuses", " backlog, ,"]));

      expect(answer.jobs.map((job) => job["id"])).toEqual(["job-older"]);
    },
    RUN_TIMEOUT_MS
  );

  test(
    "an employer no job holds answers with an empty job list",
    () => {
      const answer = answerOf(runFind(url, ["--company", "nobody-by-that-name"]));

      expect(answer).toEqual({ found_by: "employer", link_problem: null, jobs: [] });
    },
    RUN_TIMEOUT_MS
  );
});

describe("a run it refuses", () => {
  test(
    "refuses a run naming neither a link nor an employer",
    () => {
      const result = runFind(url, []);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--url");
      expect(result.stderr).toContain("--company");
    },
    RUN_TIMEOUT_MS
  );
});
