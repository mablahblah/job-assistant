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
function runSave(url: string, args: string[]): RunResult {
  const result = spawnSync("npx", ["tsx", "scripts/score-save.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

// A company put straight into the table, since nothing collected has run and
// scoring is the one step that writes a company's scores.
async function insertCompany(url: string, id: string, name: string): Promise<void> {
  const client = createClient({ url });
  try {
    // modified_at carries @updatedAt, which Prisma fills on every write and
    // the database itself has no default for, so a raw insert has to supply
    // it.
    await client.execute({
      sql: "INSERT INTO Company (id, name, match_key, modified_at) VALUES (?, ?, ?, ?)",
      args: [id, name, name.toLowerCase(), new Date().toISOString()],
    });
  } finally {
    client.close();
  }
}

// A board row for that company, the way company matching writes one after a
// posting is read. Promotion is what fills in its collector.
async function insertBoard(url: string, slug: string, companyId: string): Promise<void> {
  const client = createClient({ url });
  try {
    await client.execute({
      sql: "INSERT INTO AtsSlug (id, slug, company_id, parser, modified_at) VALUES (?, ?, ?, ?, ?)",
      args: [`board-${slug}`, slug, companyId, "greenhouse", new Date().toISOString()],
    });
  } finally {
    client.close();
  }
}

async function readBoardCollector(url: string, slug: string): Promise<string | null> {
  const client = createClient({ url });
  try {
    const result = await client.execute({
      sql: "SELECT collector FROM AtsSlug WHERE slug = ?",
      args: [slug],
    });
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
    if (!row) throw new Error(`no board row with slug ${slug}`);
    const value = row["collector"];
    return value === null ? null : String(value);
  } finally {
    client.close();
  }
}

async function readCompanyScore(url: string, id: string): Promise<number | null> {
  const client = createClient({ url });
  try {
    const result = await client.execute({
      sql: "SELECT employee_satisfaction FROM Company WHERE id = ?",
      args: [id],
    });
    const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
    if (!row) throw new Error(`no company row with id ${id}`);
    const value = row["employee_satisfaction"];
    return value === null ? null : Number(value);
  } finally {
    client.close();
  }
}

// The wiring rather than the judging: a real database in, one company's score
// out, and a trace row recording it.
describe("the score-save command", () => {
  let dir: string;
  let result: RunResult;
  let score: number | null;
  let collector: string | null;
  let traceCount: number;

  beforeAll(async () => {
    const temp = makeTempDb("pipeline-score-save-");
    dir = temp.dir;
    runScript("db-create.ts", temp.url);
    runScript("db-seed.ts", temp.url);
    await insertCompany(temp.url, "c1", "Example Co");
    await insertBoard(temp.url, "exampleco", "c1");

    const input = join(dir, "scores.json");
    writeFileSync(
      input,
      JSON.stringify({
        runId: "test-run",
        jobs: [],
        companies: [
          {
            id: "c1",
            // All four, and all high, so the company clears the seeded
            // promotion threshold and its board starts being polled.
            scores: {
              employee_satisfaction: { score: 4, rationale: "well reviewed", guessed: false },
              customer_satisfaction: { score: 4, rationale: "well reviewed", guessed: false },
              work_life_balance: { score: 4, rationale: "well reviewed", guessed: false },
              political_alignment: { score: 4, rationale: "well reviewed", guessed: false },
            },
          },
        ],
      })
    );

    result = runSave(temp.url, ["--in", input, "--summary"]);
    score = await readCompanyScore(temp.url, "c1");
    collector = await readBoardCollector(temp.url, "exampleco");

    const client = createClient({ url: temp.url });
    try {
      const rows = await client.execute("SELECT count(*) as count FROM Trace");
      const row = rows.rows[0] as unknown as Record<string, unknown>;
      traceCount = Number(row["count"]);
    } finally {
      client.close();
    }
  }, SETUP_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("exits successfully", () => {
    // The exit status alone leaves a broken command silent about why, so the
    // command's own stderr rides along in the failure message.
    expect(result.status, result.stderr).toBe(0);
  });

  test("writes the score it was handed", () => {
    expect(score).toBe(4);
  });

  // Criterion 52. A company that scores well starts being polled directly.
  test("puts a well-scored company's board on a polling list", () => {
    expect(collector).toBe("greenhouse");
  });

  test("records what it did", () => {
    expect(traceCount).toBeGreaterThan(0);
  });

  // Criteria 74 and 75. Nothing else prints a summary once scoring has run,
  // so the last save of a batch is what shows the user the finished picture.
  test("prints the run summary when asked for it", () => {
    expect(result.stdout).toContain("Alignment scoring (");
    expect(result.stdout).toContain("Company scoring (");
  });
});

describe("the score-save command without the summary flag", () => {
  test("prints no summary", () => {
    const temp = makeTempDb("pipeline-score-save-nosummary-");
    try {
      runScript("db-create.ts", temp.url);
      runScript("db-seed.ts", temp.url);
      const input = join(temp.dir, "scores.json");
      writeFileSync(input, JSON.stringify({ runId: "test-run", jobs: [], companies: [] }));

      const result = runSave(temp.url, ["--in", input]);
      expect(result.stdout).not.toContain("Alignment scoring (");
    } finally {
      rmSync(temp.dir, { recursive: true, force: true });
    }
  }, SETUP_TIMEOUT_MS);
});

describe("the score-save command without a source", () => {
  test("refuses to run and says so", () => {
    const temp = makeTempDb("pipeline-score-save-noin-");
    try {
      const result = runSave(temp.url, []);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--in");
    } finally {
      rmSync(temp.dir, { recursive: true, force: true });
    }
  });
});
