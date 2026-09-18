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

describe("criteria 180 to 185: the work log entries migrate", () => {
  let dbs: TempDbs;
  let result: RunResult;
  let rows: Array<Record<string, unknown>>;

  beforeAll(async () => {
    dbs = await makeDbs("migrate-work-log-");
    // A rejected job, so nothing else migrates and the entries stand alone.
    // The entry's own date differs from the row-written date deliberately:
    // the activity's date is the one that must survive.
    await withClient(dbs.sourceUrl, async (client) => {
      await client.execute(
        "INSERT INTO Company (id, name, updatedAt) " +
          "VALUES ('old-co', 'Pyramid Consulting, Inc.', CURRENT_TIMESTAMP)"
      );
      await client.execute(
        "INSERT INTO Job (id, companyId, title, url, firstPublished, salaryRange, status, updatedAt) " +
          "VALUES ('old-job-log', 'old-co', 'Senior UX Designer', 'https://example.com/log-job', " +
          "'2026-07-01T00:00:00.000Z', '', 'rejected', CURRENT_TIMESTAMP)"
      );
      await client.execute(
        "INSERT INTO WorkSearchEntry (id, jobId, date, activityType, createdAt) " +
          "VALUES ('e1', 'old-job-log', '2026-08-02T00:00:00.000Z', 'Applied for job', " +
          "'2026-08-04T00:00:00.000Z')"
      );
      await client.execute(
        "INSERT INTO WorkSearchEntry (id, jobId, date, activityType) " +
          "VALUES ('e2', 'old-job-log', '2026-08-10T00:00:00.000Z', 'Had interview')"
      );
    });

    result = runMigration(dbs);
    rows = await withClient(dbs.targetUrl, async (client) => {
      const read = await client.execute("SELECT * FROM WorkLogEntry ORDER BY created_at");
      return read.rows.map((row) => ({ ...(row as unknown as Record<string, unknown>) }));
    });
  }, SETUP_TIMEOUT_MS);

  // Criterion "Every entry arrives".
  test("one migrated entry exists per old entry, and the run verifies clean", () => {
    expect(result.exitCode).toBe(0);
    expect(rows).toHaveLength(2);
  });

  // Criteria "The employer name stands alone" and "The job title stands
  // alone": both are values on the entry itself, not reads through a row.
  test("each entry carries the employer name and job title as its own values", () => {
    for (const row of rows) {
      expect(row["company_name"]).toBe("Pyramid Consulting, Inc.");
      expect(row["job_title"]).toBe("Senior UX Designer");
    }
  });

  // Criterion "The week is the activity's week".
  test("the entry's date is the activity's date, not the row-written date", () => {
    expect(String(rows[0]?.["created_at"])).toContain("2026-08-02");
  });

  // Criterion "The job id survives without its job": the rejected job never
  // migrates, and the id rides along as a plain value anyway.
  test("the entry keeps its job's id although that job did not migrate", () => {
    for (const row of rows) {
      expect(row["job_id"]).toBe("old-job-log");
    }
  });

  // Criterion "Accepted wording only".
  test("every migrated activity is a wording the Texas form accepts", () => {
    const accepted = ["Applied for job", "Had phone screen", "Had interview"];
    for (const row of rows) {
      expect(accepted).toContain(row["activity"]);
    }
  });
});

describe("an old entry whose wording the form does not accept", () => {
  test(
    "stops the migration rather than migrating a filing the form would reject",
    async () => {
      const dbs = await makeDbs("migrate-bad-wording-");
      await withClient(dbs.sourceUrl, async (client) => {
        await client.execute(
          "INSERT INTO Company (id, name, updatedAt) VALUES ('old-co', 'Figma', CURRENT_TIMESTAMP)"
        );
        await client.execute(
          "INSERT INTO Job (id, companyId, title, url, firstPublished, salaryRange, status, updatedAt) " +
            "VALUES ('old-job-bad', 'old-co', 'Designer', 'https://example.com/bad', " +
            "'2026-07-01T00:00:00.000Z', '', 'rejected', CURRENT_TIMESTAMP)"
        );
        await client.execute(
          "INSERT INTO WorkSearchEntry (id, jobId, date, activityType) " +
            "VALUES ('bad', 'old-job-bad', '2026-08-02T00:00:00.000Z', 'Networking event')"
        );
      });

      const result = runMigration(dbs);

      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Networking event");
    },
    SETUP_TIMEOUT_MS
  );
});
