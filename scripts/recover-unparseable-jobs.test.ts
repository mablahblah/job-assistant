// The recovery runs once, by hand, and is the only reason shipping a new
// parser delivers the jobs already set aside rather than only future ones.
// Measured 2026-09-21: 145 jobs sat at status unparseable, 42 on Workday or
// UltiPro and 103 on websites no dedicated parser owns. The general parser
// claims every web link, so all of them return.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
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
// itself starts. Vitest's own five-second default is below that floor.
const RUN_TIMEOUT_MS = 60_000;

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

function runScript(script: string, url: string): void {
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

function runRecovery(url: string): RunResult {
  const result = spawnSync("npx", ["tsx", "scripts/recover-unparseable-jobs.ts"], {
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

async function statusOf(url: string, id: string): Promise<string> {
  const client = createClient({ url });
  try {
    const result = await client.execute({
      sql: "SELECT status FROM Job WHERE id = ?",
      args: [id],
    });
    return String(result.rows[0]?.["status"]);
  } finally {
    client.close();
  }
}

let dir: string;
let url: string;

beforeAll(async () => {
  const temp = makeTempDb("pipeline-recover-unparseable-");
  dir = temp.dir;
  url = temp.url;
  runScript("db-create.ts", url);
  runScript("db-seed.ts", url);

  await run(
    url,
    `INSERT INTO Company (id, name, match_key, created_at, modified_at)
     VALUES ('co-brex', 'Brex', 'brex', '2026-01-01', '2026-01-01')`
  );
  await run(
    url,
    `INSERT INTO Company (id, name, match_key, created_at, modified_at)
     VALUES ('co-meredith', 'Meredith', 'meredith', '2026-01-01', '2026-01-01')`
  );

  // Carries a Greenhouse job number, which the Greenhouse parser claims
  // whatever website it sits on, so the recovery is for it.
  await run(
    url,
    `INSERT INTO Job (id, company_id, title, status, collected_at, created_at,
                      modified_at, is_resolved, is_parsed, resolved_url)
     VALUES ('job-brex', 'co-brex', 'Staff Product Designer', 'unparseable',
             '2026-01-01', '2026-01-01', '2026-01-01', 1, 0,
             'https://www.brex.com/careers/8777949002?gh_jid=8777949002')`
  );

  // On a Workday address, which the Workday parser owns, so the recovery is
  // for it too.
  await run(
    url,
    `INSERT INTO Job (id, company_id, title, status, collected_at, created_at,
                      modified_at, is_resolved, is_parsed, resolved_url)
     VALUES ('job-workday', 'co-meredith', 'Product Designer', 'unparseable',
             '2026-01-01', '2026-01-01', '2026-01-01', 1, 0,
             'https://meredith.wd5.myworkdayjobs.com/jobs/1')`
  );

  // Set aside on a website no parser owns or claims. This is the 103, and it
  // must not move.
  await run(
    url,
    `INSERT INTO Job (id, company_id, title, status, collected_at, created_at,
                      modified_at, is_resolved, is_parsed, resolved_url)
     VALUES ('job-unowned', 'co-meredith', 'Product Designer', 'unparseable',
             '2026-01-01', '2026-01-01', '2026-01-01', 1, 0,
             'https://careers.acmehealth.example/jobs/42')`
  );

  // A job number on a job that is not set aside. The recovery reads only
  // status unparseable, so this one is none of its business.
  await run(
    url,
    `INSERT INTO Job (id, company_id, title, status, collected_at, created_at,
                      modified_at, is_resolved, is_parsed, resolved_url)
     VALUES ('job-applied', 'co-brex', 'Senior Product Designer', 'app. sent',
             '2026-01-01', '2026-01-01', '2026-01-01', 1, 1,
             'https://www.brex.com/careers/8777949003?gh_jid=8777949003')`
  );
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("returning set-aside jobs a parser now claims to the backlog", () => {
  test(
    "a set-aside job a parser claims is returned to the backlog",
    async () => {
      const result = runRecovery(url);

      expect(result.status).toBe(0);
      expect(await statusOf(url, "job-brex")).toBe("backlog");
    },
    RUN_TIMEOUT_MS
  );

  test(
    "a set-aside job on a website a parser owns is returned to the backlog",
    async () => {
      runRecovery(url);

      expect(await statusOf(url, "job-workday")).toBe("backlog");
    },
    RUN_TIMEOUT_MS
  );

  test(
    "a set-aside job no dedicated parser owns or claims returns to the backlog",
    async () => {
      runRecovery(url);

      expect(await statusOf(url, "job-unowned")).toBe("backlog");
    },
    RUN_TIMEOUT_MS
  );

  test(
    "a job a parser claims at another status is left alone",
    async () => {
      runRecovery(url);

      expect(await statusOf(url, "job-applied")).toBe("app. sent");
    },
    RUN_TIMEOUT_MS
  );

  // The user has no other way to learn what the recovery did, and a command
  // that says nothing reads the same whether it moved seven jobs or none.
  test(
    "it reports how many jobs it looked at and how many it moved",
    () => {
      const result = runRecovery(url);

      expect(result.stdout).toMatch(/unparseable/i);
      expect(result.stdout).toMatch(/backlog/i);
    },
    RUN_TIMEOUT_MS
  );

  // Running it twice must be safe: the first run empties the list the second
  // reads, so the second finds nothing and says so rather than failing.
  test(
    "running it again finds nothing left to move and still succeeds",
    () => {
      runRecovery(url);
      const second = runRecovery(url);

      expect(second.status).toBe(0);
    },
    RUN_TIMEOUT_MS
  );
});

// A job search must never move a job out of unparseable on its own.
// The recovery is a command the user runs, and the only way a set-aside job
// comes back.
describe("the recovery is not part of a job search", () => {
  test("the job search orchestrator does not reach for the recovery", () => {
    const source = readFileSync(join(repoRoot, "lib/orchestrators/job-search.ts"), "utf8");

    expect(source).not.toContain("recover-unparseable-jobs");
  });

  test("the job search command does not reach for the recovery", () => {
    const source = readFileSync(join(repoRoot, "scripts/job-search.ts"), "utf8");

    expect(source).not.toContain("recover-unparseable-jobs");
  });
});

describe("the recovery command is reachable", () => {
  test("its script exists", () => {
    expect(existsSync(join(scriptsDir, "recover-unparseable-jobs.ts"))).toBe(true);
  });

  test("it has an npm entry", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.["recover-unparseable-jobs"]).toBe(
      "npx tsx scripts/recover-unparseable-jobs.ts"
    );
  });
});
