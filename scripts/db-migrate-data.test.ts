import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient, type Client } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// This file lives in scripts/, so the repo root is one level up.
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

// Building two databases and running the migration spawns the prisma CLI.
// A ceiling rather than a budget: vitest runs these child processes in
// parallel and they contend for the machine.
const SETUP_TIMEOUT_MS = 240_000;

// The old database's three migrating tables, exactly as dev.db declares them.
// The real old database is untracked and keeps growing, so every test builds
// a fixture in this committed shape instead — the same reasoning as the
// committed title fixture.
const OLD_SHAPE_SQL = [
  `CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "employeeSatisfaction" INTEGER,
    "customerSatisfaction" INTEGER,
    "workLifeBalance" INTEGER,
    "politicalAlignment" INTEGER,
    "note" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "enrichedAt" DATETIME,
    "enrichmentStatus" TEXT,
    "enrichmentUncertain" BOOLEAN NOT NULL DEFAULT false,
    "enrichmentFlags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "atsPlatform" TEXT,
    "atsSlug" TEXT
  )`,
  `CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "workMode" TEXT NOT NULL DEFAULT 'remote',
    "firstPublished" DATETIME NOT NULL,
    "repostedAt" DATETIME,
    "salaryRange" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'backlog',
    "locationFlagged" BOOLEAN NOT NULL DEFAULT false,
    "jobAlignment" INTEGER,
    "titleMismatch" BOOLEAN NOT NULL DEFAULT false,
    "titleMismatchReason" TEXT,
    "source" TEXT,
    "parser" TEXT,
    "originalUrl" TEXT,
    "modifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE "WorkSearchEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "activityType" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'Application filed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

interface TempDbs {
  dir: string;
  sourceUrl: string;
  targetUrl: string;
}

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// One scratch directory holds both sides: a source in the old shape and a
// target built by the real create command.
async function makeDbs(prefix: string): Promise<TempDbs> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  const sourceUrl = `file:${join(dir, "old.db")}`;
  const targetUrl = `file:${join(dir, "pipeline.db")}`;

  const source = createClient({ url: sourceUrl });
  try {
    for (const statement of OLD_SHAPE_SQL) {
      await source.execute(statement);
    }
  } finally {
    source.close();
  }

  execFileSync("npx", ["tsx", "scripts/db-create.ts", targetUrl], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: targetUrl },
    stdio: "pipe",
  });

  return { dir, sourceUrl, targetUrl };
}

interface RunResult {
  exitCode: number;
  output: string;
}

// The source travels as DATABASE_URL and the target as PIPELINE_DATABASE_URL,
// the same two names the old and new pipelines already read from .env.
function runMigration(dbs: TempDbs): RunResult {
  try {
    const stdout = execFileSync("npx", ["tsx", "scripts/db-migrate-data.ts"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: dbs.sourceUrl,
        PIPELINE_DATABASE_URL: dbs.targetUrl,
      },
      stdio: "pipe",
    });
    return { exitCode: 0, output: String(stdout) };
  } catch (thrown) {
    const failure = thrown as { status?: number | null; stdout?: Buffer; stderr?: Buffer };
    if (typeof failure.status !== "number") throw thrown;
    return {
      exitCode: failure.status,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

async function withClient<T>(url: string, read: (client: Client) => Promise<T>): Promise<T> {
  const client = createClient({ url });
  try {
    return await read(client);
  } finally {
    client.close();
  }
}

async function countRows(url: string, table: string): Promise<number> {
  return withClient(url, async (client) => {
    const result = await client.execute(`SELECT count(*) AS count FROM ${table}`);
    return Number((result.rows[0] as unknown as Record<string, unknown>)["count"]);
  });
}

// A source holding one complete chain — employer, active job, entry — so a
// run against it has something to count.
async function fillSource(url: string): Promise<void> {
  await withClient(url, async (client) => {
    await client.execute(
      "INSERT INTO Company (id, name, updatedAt) VALUES ('old-co', 'Figma', CURRENT_TIMESTAMP)"
    );
    await client.execute(
      "INSERT INTO Job (id, companyId, title, url, firstPublished, salaryRange, status, source, updatedAt) " +
        "VALUES ('old-job', 'old-co', 'Senior Product Designer', 'https://example.com/job', " +
        "'2026-08-01T00:00:00.000Z', '', 'app. sent', 'adzuna', CURRENT_TIMESTAMP)"
    );
    await client.execute(
      "INSERT INTO WorkSearchEntry (id, jobId, date, activityType) " +
        "VALUES ('old-entry', 'old-job', '2026-08-02T00:00:00.000Z', 'Application')"
    );
  });
}

describe("criteria 212, 213, 214, 215: the migration refuses the wrong target", () => {
  // Criterion "It runs once". A target already holding work log entries is a
  // target the migration has already filled, and a second run would double
  // the legal record silently.
  test(
    "a target already holding work log entries is refused",
    async () => {
      const dbs = await makeDbs("migrate-guard-entries-");
      await withClient(dbs.targetUrl, (client) =>
        client.execute(
          "INSERT INTO WorkLogEntry (id, job_id, company_name, job_title, activity) " +
            "VALUES ('w1', 'j1', 'Figma', 'Designer', 'Applied for job')"
        )
      );

      const result = runMigration(dbs);

      expect(result.exitCode).not.toBe(0);
    },
    SETUP_TIMEOUT_MS
  );

  // Criterion "A target holding jobs is refused".
  test(
    "a target holding any job row is refused",
    async () => {
      const dbs = await makeDbs("migrate-guard-jobs-");
      await withClient(dbs.targetUrl, (client) =>
        client.execute(
          "INSERT INTO Job (id, collector, collected_at, modified_at) " +
            "VALUES ('j1', 'user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')"
        )
      );

      const result = runMigration(dbs);

      expect(result.exitCode).not.toBe(0);
    },
    SETUP_TIMEOUT_MS
  );

  // Criterion "A target holding employers is refused".
  test(
    "a target holding any employer row is refused",
    async () => {
      const dbs = await makeDbs("migrate-guard-companies-");
      await withClient(dbs.targetUrl, (client) =>
        client.execute(
          "INSERT INTO Company (id, name, match_key, modified_at) " +
            "VALUES ('c1', 'Figma', 'figma', CURRENT_TIMESTAMP)"
        )
      );

      const result = runMigration(dbs);

      expect(result.exitCode).not.toBe(0);
    },
    SETUP_TIMEOUT_MS
  );

  // Criterion "A stale target is refused". Dropping a column reproduces a
  // target whose tables no longer match the code, the same probe the
  // job-search drift test uses.
  test(
    "a target whose tables do not match the code is refused",
    async () => {
      const dbs = await makeDbs("migrate-guard-stale-");
      await withClient(dbs.targetUrl, (client) =>
        client.execute("ALTER TABLE Trace DROP COLUMN domain")
      );

      const result = runMigration(dbs);

      expect(result.exitCode).not.toBe(0);
    },
    SETUP_TIMEOUT_MS
  );
});

describe("criterion 218: a clean run against an empty source", () => {
  let dbs: TempDbs;
  let result: RunResult;

  beforeAll(async () => {
    dbs = await makeDbs("migrate-clean-");
    result = runMigration(dbs);
  }, SETUP_TIMEOUT_MS);

  test("it exits reporting success", () => {
    expect(result.exitCode).toBe(0);
  });

  // Criterion "It writes no trace rows". A migration is not a job search, so
  // nothing it does may enter the per-run counts.
  test("it writes no trace rows", async () => {
    expect(await countRows(dbs.targetUrl, "Trace")).toBe(0);
  });
});

describe("criteria 216, 217: verification counts both sides live", () => {
  let dbs: TempDbs;
  let result: RunResult;

  beforeAll(async () => {
    dbs = await makeDbs("migrate-verify-");
    await fillSource(dbs.sourceUrl);
    result = runMigration(dbs);
  }, SETUP_TIMEOUT_MS);

  // The source holds real records and nothing has migrated them yet, so
  // every count disagrees. The frame's verification has to catch that on its
  // own, before any migrator exists to make the counts match.
  test("a mismatch fails the run", () => {
    expect(result.exitCode).not.toBe(0);
  });

  test("the mismatch is named in the output", () => {
    expect(result.output.toLowerCase()).toContain("work log");
  });
});
