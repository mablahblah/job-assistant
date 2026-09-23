// Flow test: Set-aside jobs are recovered once, by hand.
//
// A database holding jobs set aside because no parser owned their link: one on
// Workday, one on UltiPro, and one on a website no parser owns. A job search
// runs, then the recovery command runs exactly as the user types it, then the
// project's commands are listed. Each job's status is read after each step.
//
// Measured 2026-09-21: 145 jobs sat set aside, 42 on Workday or UltiPro and
// 103 on websites no parser owns. The 103 must stay exactly where they are.
//
// Covers: Set-aside jobs a parser now claims return to the backlog, Other
// set-aside jobs are left alone, A job search never runs the recovery, The
// Greenhouse-only recovery command is gone.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Creating, seeding, a job search and the recovery each spawn a command in
// turn. A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const JOBS = {
  workday: {
    id: "job-workday",
    link: "https://meredith.wd5.myworkdayjobs.com/EXT/job/New-York-NY/Director--Design_JR15366",
  },
  ultipro: {
    id: "job-ultipro",
    link:
      "https://recruiting.ultipro.com/tel1010tefo/jobboard/914e6c7a-35d4-4079-865a-b3a7e7758070" +
      "/opportunitydetail?opportunityid=e3a376f8-6759-4047-a7e7-79a7a3457ab0&utm_source=adzuna",
  },
  unowned: {
    id: "job-unowned",
    link: "https://careers.acmehealth.example/jobs/42",
  },
};

function runScript(script: string, url: string): void {
  const args = script === "db-create.ts" ? [url] : [];
  execFileSync("npx", ["tsx", `scripts/${script}`, ...args], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

// Run with spawnSync rather than execFileSync, so a command that fails is a
// result to inspect rather than a throw that skips every later step.
function run(command: string, args: string[], url: string): { status: number | null; output: string } {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

async function execute(url: string, sql: string, args: string[] = []) {
  const client = createClient({ url });
  try {
    return await client.execute({ sql, args });
  } finally {
    client.close();
  }
}

async function statuses(url: string): Promise<Record<string, string>> {
  const result = await execute(url, "SELECT id, status FROM Job");
  return Object.fromEntries(result.rows.map((row) => [String(row["id"]), String(row["status"])]));
}

describe("Set-aside jobs are recovered once, by hand", () => {
  let dir: string;
  let afterJobSearch: Record<string, string>;
  let recovery: { status: number | null; output: string };
  let afterRecovery: Record<string, string>;
  let commands: Record<string, string>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-recover-unparseable-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);

    await execute(
      url,
      `INSERT INTO Company (id, name, match_key, created_at, modified_at)
       VALUES ('co-any', 'Any Employer', 'any employer', '2026-01-01', '2026-01-01')`
    );
    for (const job of Object.values(JOBS)) {
      await execute(
        url,
        `INSERT INTO Job (id, company_id, title, status, collected_at, created_at,
                          modified_at, is_resolved, is_parsed, original_url, resolved_url)
         VALUES (?, 'co-any', 'Product Designer', 'unparseable',
                 '2026-01-01', '2026-01-01', '2026-01-01', 1, 0, ?, ?)`,
        [job.id, job.link, job.link]
      );
    }

    // A whole job search, reaching no job site. Whatever it does, it must not
    // bring a set-aside job back on its own.
    const search = run("npx", ["tsx", "scripts/job-search.ts", "--limit", "0"], url);
    if (search.status !== 0) throw new Error(`the job search failed:\n${search.output}`);
    afterJobSearch = await statuses(url);

    recovery = run("npm", ["run", "recover-unparseable-jobs"], url);
    afterRecovery = await statuses(url);

    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    commands = pkg.scripts ?? {};
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("Set-aside jobs a parser now claims return to the backlog", () => {
    expect(recovery.status, recovery.output).toBe(0);
    expect(afterRecovery[JOBS.workday.id]).toBe("backlog");
    expect(afterRecovery[JOBS.ultipro.id]).toBe("backlog");
  });

  test("Other set-aside jobs are left alone", () => {
    expect(afterRecovery[JOBS.unowned.id]).toBe("unparseable");
  });

  test("A job search never runs the recovery", () => {
    expect(afterJobSearch).toEqual({
      [JOBS.workday.id]: "unparseable",
      [JOBS.ultipro.id]: "unparseable",
      [JOBS.unowned.id]: "unparseable",
    });
  });

  test("The Greenhouse-only recovery command is gone", () => {
    expect(Object.keys(commands)).not.toContain("recover-greenhouse-jobs");
  });
});
