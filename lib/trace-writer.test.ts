import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "./pipeline-db";
import { createTraceWriter, type TraceEvent, type TraceWriter } from "./trace-writer";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..");

// Creating a scratch database measured well under two seconds. This is a
// ceiling rather than a budget.
const CREATE_TIMEOUT_MS = 45_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

// An absolute url, because a relative Prisma url resolves from the directory
// holding prisma.config.ts rather than from the working directory.
function makeTempDb(prefix: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "pipeline.db")}` };
}

// Runs a real script against a scratch database. The url travels in the
// environment because dotenv never overwrites a variable that is already set,
// so this value wins over the repo's .env and the real pipeline.db is never
// touched.
function runScript(script: string, url: string): void {
  execFileSync("npx", ["tsx", `scripts/${script}`], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

// Schema only. The writer reads no settings, so nothing needs seeding.
function createDb(prefix: string): { dir: string; url: string } {
  const temp = makeTempDb(prefix);
  runScript("db-create.ts", temp.url);
  return temp;
}

// Runs a statement returning no rows, such as the DROP TABLE that produces a
// genuine write failure.
async function runSql(url: string, sql: string): Promise<void> {
  const client = createClient({ url });
  try {
    await client.execute(sql);
  } finally {
    client.close();
  }
}

// Reads rows through a connection of its own rather than the writer's client,
// so a passing read proves the row reached the database file.
async function queryTrace(
  url: string,
  sql: string,
  args: string[]
): Promise<Record<string, unknown>[]> {
  const client = createClient({ url });
  try {
    const result = await client.execute({ sql, args });
    return result.rows.map((row) => row as unknown as Record<string, unknown>);
  } finally {
    client.close();
  }
}

// Points a real client at the scratch database. createPipelineDb reads the
// url at call time, so the environment only has to hold the scratch value for
// the moment of construction, and whatever was there before is put back.
function buildWriter(url: string): { db: PipelineDb; writer: TraceWriter } {
  const previous = process.env["PIPELINE_DATABASE_URL"];
  process.env["PIPELINE_DATABASE_URL"] = url;
  const db = createPipelineDb();
  if (previous === undefined) delete process.env["PIPELINE_DATABASE_URL"];
  else process.env["PIPELINE_DATABASE_URL"] = previous;
  return { db, writer: createTraceWriter(db) };
}

async function cleanup(dir: string, db: PipelineDb): Promise<void> {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
}

function collectedEvent(jobId: string): TraceEvent {
  return {
    run_id: "run-1",
    job_id: jobId,
    step: "collection",
    event: "collected",
    collector: "adzuna",
  };
}

describe("the writer takes its database client from its caller", () => {
  let dirA: string;
  let dirB: string;
  let dbA: PipelineDb;
  let dbB: PipelineDb;
  let urlA: string;
  let urlB: string;
  let writerA: TraceWriter;

  beforeAll(() => {
    const tempA = createDb("pipeline-trace-caller-a-");
    const tempB = createDb("pipeline-trace-caller-b-");
    dirA = tempA.dir;
    dirB = tempB.dir;
    urlA = tempA.url;
    urlB = tempB.url;
    ({ db: dbA, writer: writerA } = buildWriter(urlA));
    ({ db: dbB } = buildWriter(urlB));
  }, CREATE_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup(dirA, dbA);
    await cleanup(dirB, dbB);
  });

  test("a write lands only in the database the writer was built with", async () => {
    await writerA.write(collectedEvent("job-caller"));

    const inA = await queryTrace(urlA, "SELECT * FROM Trace WHERE job_id = ?", ["job-caller"]);
    const inB = await queryTrace(urlB, "SELECT * FROM Trace WHERE job_id = ?", ["job-caller"]);
    expect(inA.length).toBe(1);
    expect(inB.length).toBe(0);
  });

  test("a write still reaches its database with no url in the environment", async () => {
    // A writer that re-read the url at call time rather than keeping the
    // client it was handed would have nothing to fall back on here.
    const previous = process.env["PIPELINE_DATABASE_URL"];
    delete process.env["PIPELINE_DATABASE_URL"];
    try {
      await writerA.write(collectedEvent("job-no-env"));
    } finally {
      if (previous !== undefined) process.env["PIPELINE_DATABASE_URL"] = previous;
    }

    const rows = await queryTrace(urlA, "SELECT * FROM Trace WHERE job_id = ?", ["job-no-env"]);
    expect(rows.length).toBe(1);
  });
});

describe("a write records exactly what the caller passed", () => {
  let dir: string;
  let db: PipelineDb;
  let url: string;
  let writer: TraceWriter;

  beforeAll(() => {
    const temp = createDb("pipeline-trace-columns-");
    dir = temp.dir;
    url = temp.url;
    ({ db, writer } = buildWriter(url));
  }, CREATE_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("every column holds the value the caller passed", async () => {
    const event: TraceEvent = {
      run_id: "run-full",
      job_id: "job-full",
      step: "collection",
      event: "abandoned",
      collector: "greenhouse",
      reason: "original_url_not_a_url",
      detail: "htp:/broken",
    };

    await writer.write(event);

    const [row] = await queryTrace(url, "SELECT * FROM Trace WHERE job_id = ?", [event.job_id]);
    expect(row?.["run_id"]).toBe(event.run_id);
    expect(row?.["job_id"]).toBe(event.job_id);
    expect(row?.["step"]).toBe(event.step);
    expect(row?.["event"]).toBe(event.event);
    expect(row?.["collector"]).toBe(event.collector);
    expect(row?.["reason"]).toBe(event.reason);
    // detail is a Json column, so a string arrives back through raw SQL as
    // quoted JSON text rather than as the bare string.
    expect(row?.["detail"]).toBe(JSON.stringify(event.detail));
  });

  test("reason and detail left off the call arrive as null", async () => {
    await writer.write(collectedEvent("job-minimal"));

    const [row] = await queryTrace(url, "SELECT * FROM Trace WHERE job_id = ?", ["job-minimal"]);
    expect(row?.["reason"]).toBeNull();
    expect(row?.["detail"]).toBeNull();
  });

  test("the row is readable through a separate connection as soon as the write returns", async () => {
    await writer.write(collectedEvent("job-committed"));

    const rows = await queryTrace(url, "SELECT * FROM Trace WHERE job_id = ?", ["job-committed"]);
    expect(rows.length).toBe(1);
  });
});

// The writer runs inside the collection orchestrator's try block around each
// collector call, where a throw is read as a collector failure and costs every
// remaining job from that source.
describe("a failing write is swallowed and counted", () => {
  let dir: string;
  let db: PipelineDb;
  let url: string;
  let writer: TraceWriter;

  beforeAll(() => {
    const temp = createDb("pipeline-trace-failures-");
    dir = temp.dir;
    url = temp.url;
    ({ db, writer } = buildWriter(url));
  }, CREATE_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("the count starts at zero", () => {
    expect(writer.failureCount()).toBe(0);
  });

  test("a successful write leaves the count at zero", async () => {
    await writer.write(collectedEvent("job-ok"));
    expect(writer.failureCount()).toBe(0);
  });

  test("a write against a missing table resolves rather than throwing", async () => {
    await runSql(url, "DROP TABLE Trace");

    await expect(writer.write(collectedEvent("job-fail-1"))).resolves.toBeUndefined();
    expect(writer.failureCount()).toBe(1);
  });

  test("a second failed write raises the count again", async () => {
    await writer.write(collectedEvent("job-fail-2"));
    expect(writer.failureCount()).toBe(2);
  });
});

describe("writes made one after another land in that order", () => {
  let dir: string;
  let db: PipelineDb;
  let url: string;
  let writer: TraceWriter;

  beforeAll(() => {
    const temp = createDb("pipeline-trace-order-");
    dir = temp.dir;
    url = temp.url;
    ({ db, writer } = buildWriter(url));
  }, CREATE_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("the second awaited write gets a higher id than the first", async () => {
    await writer.write(collectedEvent("job-order-1"));
    await writer.write(collectedEvent("job-order-2"));

    const [first] = await queryTrace(url, "SELECT id FROM Trace WHERE job_id = ?", ["job-order-1"]);
    const [second] = await queryTrace(url, "SELECT id FROM Trace WHERE job_id = ?", ["job-order-2"]);
    expect(Number(second?.["id"])).toBeGreaterThan(Number(first?.["id"]));
  });
});
