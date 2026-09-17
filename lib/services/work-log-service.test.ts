import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "../db/pipeline-db";
import { createWorkLogService, type WorkLogInput, type WorkLogService } from "./work-log-service";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..", "..");

// Creating a scratch database runs the prisma CLI in a child process, which
// is the slow part. A ceiling rather than a budget.
// Raised from 45 seconds, which a full-suite run exceeded: vitest runs
// these child processes in parallel and they contend for the machine.
const CREATE_TIMEOUT_MS = 120_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

// The url travels in the environment because dotenv never overwrites a
// variable that is already set, so this value wins over the repo's .env and
// the real pipeline.db is never touched.
function runScript(script: string, url: string): void {
  execFileSync("npx", ["tsx", `scripts/${script}`], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

// Reads rows through a connection of its own rather than the writer's client,
// so a passing read proves the row reached the database file.
async function query(
  url: string,
  sql: string,
  args: string[] = []
): Promise<Record<string, unknown>[]> {
  const client = createClient({ url });
  try {
    const result = await client.execute({ sql, args });
    return result.rows.map((row) => row as unknown as Record<string, unknown>);
  } finally {
    client.close();
  }
}

async function runSql(url: string, sql: string): Promise<void> {
  const client = createClient({ url });
  try {
    await client.execute(sql);
  } finally {
    client.close();
  }
}

// createPipelineDb reads the url at call time, so the environment only has to
// hold the scratch value for the moment of construction.
function buildDb(url: string): PipelineDb {
  const previous = process.env["PIPELINE_DATABASE_URL"];
  process.env["PIPELINE_DATABASE_URL"] = url;
  const db = createPipelineDb();
  if (previous === undefined) delete process.env["PIPELINE_DATABASE_URL"];
  else process.env["PIPELINE_DATABASE_URL"] = previous;
  return db;
}

function entryFor(jobId: string, overrides: Partial<WorkLogInput> = {}): WorkLogInput {
  return {
    job_id: jobId,
    company_name: "Figma",
    job_title: "Senior Product Designer",
    activity: "Applied for job",
    ...overrides,
  };
}

let dir: string;
let url: string;
let db: PipelineDb;
let service: WorkLogService;

beforeAll(() => {
  const temp = makeTempDb("pipeline-work-log-");
  dir = temp.dir;
  url = temp.url;
  runScript("db-create.ts", url);
  db = buildDb(url);
  service = createWorkLogService(db);
}, CREATE_TIMEOUT_MS);

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

// Criteria 15, 16 and 17.
describe("writing one entry", () => {
  test("the row reaches the database", async () => {
    await service.write(entryFor("job-write-1"));

    const rows = await query(url, "SELECT * FROM WorkLogEntry WHERE job_id = ?", ["job-write-1"]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      job_id: "job-write-1",
      company_name: "Figma",
      job_title: "Senior Product Designer",
      activity: "Applied for job",
    });
  });

  test("the written entry comes back with the id the database gave it", async () => {
    const written = await service.write(entryFor("job-write-2"));

    expect(written.id).toBeTruthy();
    expect(written.job_id).toBe("job-write-2");
    expect(written.created_at).toBeInstanceOf(Date);
  });

  test("two entries for one job are two rows", async () => {
    await service.write(entryFor("job-write-3", { activity: "Applied for job" }));
    await service.write(entryFor("job-write-3", { activity: "Had interview" }));

    const rows = await query(url, "SELECT * FROM WorkLogEntry WHERE job_id = ?", ["job-write-3"]);

    expect(rows).toHaveLength(2);
  });
});

// Criteria 22, 23 and 24. The entry carries the employer name and the job
// title as plain values rather than reading through to the rows holding
// them, so neither row changing nor going away rewrites a filing already
// made. A job holding an entry cannot be deleted while it is still active,
// so it is moved to rejected first, which is the real sequence.
describe("an entry outliving the job it names", () => {
  test("still names the employer and the title after the job row is deleted", async () => {
    await db.company.create({ data: { id: "co-outlive", name: "Outlive Co" } });
    await db.job.create({
      data: {
        id: "job-outlive",
        company_id: "co-outlive",
        title: "Senior Product Designer",
        status: "app. sent",
        collected_at: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    await service.write(
      entryFor("job-outlive", { company_name: "Outlive Co", job_title: "Senior Product Designer" })
    );

    await db.job.update({ where: { id: "job-outlive" }, data: { status: "rejected" } });
    await db.job.delete({ where: { id: "job-outlive" } });

    const rows = await query(url, "SELECT * FROM WorkLogEntry WHERE job_id = ?", ["job-outlive"]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      company_name: "Outlive Co",
      job_title: "Senior Product Designer",
    });
  });

  test("still names the employer as it stood after that employer is renamed", async () => {
    await db.company.create({ data: { id: "co-renamed", name: "Old Name Co" } });

    await service.write(entryFor("job-renamed", { company_name: "Old Name Co" }));

    await db.company.update({ where: { id: "co-renamed" }, data: { name: "New Name Co" } });

    const rows = await query(url, "SELECT * FROM WorkLogEntry WHERE job_id = ?", ["job-renamed"]);

    expect(rows[0]).toMatchObject({ company_name: "Old Name Co" });
  });
});

// Criterion 29, and the one place this service parts company with the trace
// service. Tracing swallows a failed write and counts it, because losing a
// trace row is cheaper than losing the rest of a run. A work log entry is a
// legal filing, so a failure has to reach the caller and be reported.
describe("a write the database refuses", () => {
  test("the failure reaches the caller rather than being swallowed", async () => {
    const temp = makeTempDb("pipeline-work-log-broken-");
    runScript("db-create.ts", temp.url);
    await runSql(temp.url, "DROP TABLE WorkLogEntry");
    const brokenDb = buildDb(temp.url);
    const broken = createWorkLogService(brokenDb);

    await expect(broken.write(entryFor("job-refused"))).rejects.toThrow();

    await brokenDb.$disconnect();
    rmSync(temp.dir, { recursive: true, force: true });
  }, CREATE_TIMEOUT_MS);
});
