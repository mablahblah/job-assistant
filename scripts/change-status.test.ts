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

// No search credential is set for any of these runs, so nothing here can
// reach the paid search service. Criterion 85. The key is blanked rather than
// deleted: the command loads .env, which fills a missing key with the real one
// but never overwrites a set one, even a blank one.
function runChange(url: string, args: string[]): RunResult {
  const env: NodeJS.ProcessEnv = { ...process.env, PIPELINE_DATABASE_URL: url };
  env["APIFY_API_TOKEN"] = "";
  const result = spawnSync("npx", ["tsx", "scripts/change-status.ts", ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function query(url: string, sql: string, args: string[] = []): Promise<unknown[]> {
  const client = createClient({ url });
  try {
    const result = await client.execute({ sql, args });
    return result.rows;
  } finally {
    client.close();
  }
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
let submissionDir: string;

function submission(name: string, body: unknown): string {
  const path = join(submissionDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

beforeAll(async () => {
  const temp = makeTempDb("pipeline-change-status-");
  dir = temp.dir;
  url = temp.url;
  submissionDir = mkdtempSync(join(tmpdir(), "change-status-in-"));
  runScript("db-create.ts", url);
  runScript("db-seed.ts", url);

  await run(
    url,
    `INSERT INTO Company (id, name, match_key, created_at, modified_at)
     VALUES ('co-1', 'Figma', 'figma', '2026-01-01', '2026-01-01')`
  );
  for (const id of ["job-a", "job-b", "job-c"]) {
    await run(
      url,
      `INSERT INTO Job (id, company_id, title, status, collected_at, created_at, modified_at,
                        is_resolved, is_parsed, is_classified)
       VALUES ('${id}', 'co-1', 'Senior Product Designer', 'backlog',
               '2026-01-01', '2026-01-01', '2026-01-01', 1, 1, 1)`
    );
  }
}, SETUP_TIMEOUT_MS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(submissionDir, { recursive: true, force: true });
});

describe("running a submission", () => {
  test("the status is written and the run says so", async () => {
    const path = submission("one", [{ job_id: "job-a", status: "app. sent" }]);

    const result = runChange(url, ["--in", path]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("job-a");
    const rows = await query(url, "SELECT status FROM Job WHERE id = 'job-a'");
    expect(rows[0]).toMatchObject({ status: "app. sent" });
  }, RUN_TIMEOUT_MS);

  // Criterion 79. The run waits for every write before it exits, so a record
  // the report claims exists really is on disk once the process is gone.
  test("the work log entry is on disk once the command has exited", async () => {
    const path = submission("entry", [{ job_id: "job-b", status: "screening" }]);

    runChange(url, ["--in", path]);

    const rows = await query(url, "SELECT * FROM WorkLogEntry WHERE job_id = 'job-b'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ activity: "Had phone screen", company_name: "Figma" });
  }, RUN_TIMEOUT_MS);

  test("a job no row holds is reported with the fixed phrase", () => {
    const path = submission("ghost", [{ job_id: "ghost", status: "rejected" }]);

    const result = runChange(url, ["--in", path]);

    expect(result.stdout).toContain("no job holds that id");
  }, RUN_TIMEOUT_MS);
});

// Criteria 4 and 5. A typo must not put a job into a state no query reads,
// and refusing the whole submission is what stops half a batch landing.
describe("a status the database does not accept", () => {
  test("the run names the status it refused", () => {
    const path = submission("bad", [{ job_id: "job-c", status: "applied" }]);

    const result = runChange(url, ["--in", path]);

    expect(result.stdout + result.stderr).toContain("applied");
  }, RUN_TIMEOUT_MS);

  test("the run refuses rather than succeeding", () => {
    const path = submission("bad2", [{ job_id: "job-c", status: "applied" }]);

    expect(runChange(url, ["--in", path]).status).not.toBe(0);
  }, RUN_TIMEOUT_MS);

  test("no job in the submission is changed", async () => {
    const path = submission("mixed", [
      { job_id: "job-c", status: "app. sent" },
      { job_id: "job-a", status: "applied" },
    ]);

    runChange(url, ["--in", path]);

    const rows = await query(url, "SELECT status FROM Job WHERE id = 'job-c'");
    expect(rows[0]).toMatchObject({ status: "backlog" });
  }, RUN_TIMEOUT_MS);

  test("every one of the twelve statuses is accepted", () => {
    const path = submission("valid", [{ job_id: "job-c", status: "won't apply" }]);

    expect(runChange(url, ["--in", path]).status).toBe(0);
  }, RUN_TIMEOUT_MS);
});

describe("a submission the command cannot read", () => {
  test("no file named at all is refused", () => {
    expect(runChange(url, []).status).not.toBe(0);
  }, RUN_TIMEOUT_MS);

  test("a file that does not exist is refused", () => {
    expect(runChange(url, ["--in", join(submissionDir, "nope.json")]).status).not.toBe(0);
  }, RUN_TIMEOUT_MS);

  test("a file holding something other than a list is refused", () => {
    const path = submission("object", { job_id: "job-a", status: "rejected" });

    expect(runChange(url, ["--in", path]).status).not.toBe(0);
  }, RUN_TIMEOUT_MS);

  test("an entry missing its job id is refused", () => {
    const path = submission("noid", [{ status: "rejected" }]);

    expect(runChange(url, ["--in", path]).status).not.toBe(0);
  }, RUN_TIMEOUT_MS);
});

// Criteria 73 and 74. The check reads each table whole and reports only the
// table's name, so that is what the refusal can honestly say.
describe("a database that no longer matches the code", () => {
  test("the command refuses to run", async () => {
    const temp = makeTempDb("pipeline-change-status-stale-");
    runScript("db-create.ts", temp.url);
    await run(temp.url, "DROP TABLE WorkLogEntry");
    const path = submission("stale", [{ job_id: "job-a", status: "rejected" }]);

    const result = runChange(temp.url, ["--in", path]);

    expect(result.status).not.toBe(0);
    rmSync(temp.dir, { recursive: true, force: true });
  }, SETUP_TIMEOUT_MS);

  test("the refusal names the table it could not read", async () => {
    const temp = makeTempDb("pipeline-change-status-stale2-");
    runScript("db-create.ts", temp.url);
    await run(temp.url, "DROP TABLE WorkLogEntry");
    const path = submission("stale2", [{ job_id: "job-a", status: "rejected" }]);

    const result = runChange(temp.url, ["--in", path]);

    expect(result.stdout + result.stderr).toContain("WorkLogEntry");
    rmSync(temp.dir, { recursive: true, force: true });
  }, SETUP_TIMEOUT_MS);
});

// The real job service rebuilds a job's stored keys from its links on every
// write, so the command has to hand it the seeded identifying values or
// UltiPro's opportunityid is stripped out of the key.
describe("an UltiPro job's status change", () => {
  const BOARD = "https://recruiting.ultipro.com/acm1000acme/jobboard/5b3c/opportunitydetail";
  const key = `${BOARD}?opportunityid=A1`;

  test("keeps the job's opportunityid in its stored key", async () => {
    await run(
      url,
      `INSERT INTO Job (id, company_id, title, status, collected_at, created_at, modified_at,
                        is_resolved, is_parsed, is_classified,
                        resolved_url, resolved_url_match_key)
       VALUES ('job-ultipro', 'co-1', 'Senior Product Designer', 'backlog',
               '2026-01-01', '2026-01-01', '2026-01-01', 1, 1, 1,
               '${key}&utm_source=adzuna', '${key}')`
    );
    const path = submission("ultipro", [{ job_id: "job-ultipro", status: "won't apply" }]);

    const result = runChange(url, ["--in", path]);

    expect(result.status).toBe(0);
    const rows = await query(
      url,
      "SELECT status, resolved_url_match_key FROM Job WHERE id = 'job-ultipro'"
    );
    expect(rows[0]).toMatchObject({ status: "won't apply", resolved_url_match_key: key });
  }, RUN_TIMEOUT_MS);
});
