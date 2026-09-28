// Flow test: Recovery and seeding bring the general parser in.
//
// A database whose source ranking list holds every source from before the
// general parser, and one job set aside as unreadable on a website no
// dedicated parser claims. The seed command runs, then the recovery command,
// each exactly as the user types it. The ranking list and the job's status
// are read after each.
//
// Covers: Recovery returns every set-aside job with a link, The general parser
// joins the list last.
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

// Creating, seeding twice and the recovery each spawn a command in turn. A
// ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const GENERAL = "parser:general";

const SET_ASIDE_JOB = {
  id: "job-unclaimed",
  link: "https://careers.acmehealth.example/jobs/42",
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

async function rankingList(url: string): Promise<string[]> {
  const result = await execute(url, "SELECT source_priority_list FROM Setting WHERE id = 1");
  return JSON.parse(String(result.rows[0]?.["source_priority_list"] ?? "[]")) as string[];
}

describe("Recovery and seeding bring the general parser in", () => {
  let dir: string;
  let listBefore: string[];
  let listAfterSeed: string[];
  let recovery: { status: number | null; output: string };
  let statusAfterRecovery: string | undefined;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-general-recovery-seed-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);

    // Put the list back to the one a database held before the general parser:
    // every other source, in the order the seed wrote them.
    listBefore = (await rankingList(url)).filter((entry) => entry !== GENERAL);
    await execute(url, "UPDATE Setting SET source_priority_list = ? WHERE id = 1", [
      JSON.stringify(listBefore),
    ]);

    await execute(
      url,
      `INSERT INTO Company (id, name, match_key, created_at, modified_at)
       VALUES ('co-any', 'Acme Health', 'acme health', '2026-01-01', '2026-01-01')`
    );
    await execute(
      url,
      `INSERT INTO Job (id, company_id, title, status, collected_at, created_at,
                        modified_at, is_resolved, is_parsed, original_url, resolved_url)
       VALUES (?, 'co-any', 'Product Designer', 'unparseable',
               '2026-01-01', '2026-01-01', '2026-01-01', 1, 0, ?, ?)`,
      [SET_ASIDE_JOB.id, SET_ASIDE_JOB.link, SET_ASIDE_JOB.link]
    );

    runScript("db-seed.ts", url);
    listAfterSeed = await rankingList(url);

    recovery = run("npm", ["run", "recover-unparseable-jobs"], url);
    const row = await execute(url, "SELECT status FROM Job WHERE id = ?", [SET_ASIDE_JOB.id]);
    statusAfterRecovery = row.rows[0]?.["status"] as string | undefined;
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("Recovery returns every set-aside job with a link", () => {
    expect(recovery.status, recovery.output).toBe(0);
    expect(statusAfterRecovery).toBe("backlog");
  });

  test("The general parser joins the list last", () => {
    expect(listAfterSeed).toEqual([...listBefore, GENERAL]);
  });
});
