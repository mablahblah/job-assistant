// Runs a real collection through the real trace writer against a scratch
// SQLite file, then answers the funnel questions with raw SQL read back
// through a separate connection. Every other trace test uses a fake writer;
// this is the proof that events written during a real run land in the
// database in a shape a query can actually read.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "./pipeline-db";
import { createTraceWriter, type TraceWriter } from "./trace-writer";
import { runCollection, type CollectionReport } from "./search-orchestrator";
import type { Collector } from "./collectors/types";
import type { JobListEntry } from "./job-list-entry";
import type { SettingsService } from "./settings-service";

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

// Schema only. Collection reads no settings, so nothing needs seeding.
function createDb(prefix: string): { dir: string; url: string } {
  const temp = makeTempDb(prefix);
  runScript("db-create.ts", temp.url);
  return temp;
}

// Reads rows through a connection of its own rather than the writer's client,
// so a passing read proves the row reached the database file. Every SQL
// string in this suite is a literal passed in here — this file is the only
// place a query is written anywhere in the project.
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

// The orchestrator only reads settings through this interface; nothing under
// test here exercises any of these getters.
const stubSettings: SettingsService = {
  getSearchTerms: async () => [],
  getLocation: async () => "",
  getRadius: async () => 0,
  getExpiryThreshold: async () => 0,
  getAtsCompanies: async () => [],
};

// The smallest job that survives the usability check: a link, a title, and
// an employer.
function makeJob(title: string): JobListEntry {
  return {
    original_url: `https://example.com/${title}`,
    raw_title: title,
    raw_company_name: "Example",
  };
}

// Two fake collectors. Each returns fixed data with no request, no browser,
// and no file on disk, so this test reaches no job site. One job from each
// is deliberately unusable, so every collector produces both a "collected"
// and an "abandoned" event.
const adzunaCollector: Collector = {
  name: "adzuna",
  async collect() {
    return {
      jobs: [
        makeJob("Product Designer"),
        makeJob("UX Researcher"),
        // Dropped for no_raw_title.
        { ...makeJob("Ghost Listing"), raw_title: undefined },
      ],
      errors: [],
      warnings: [],
    };
  },
};

const greenhouseCollector: Collector = {
  name: "greenhouse",
  async collect() {
    return {
      jobs: [
        makeJob("Staff Writer"),
        // Dropped for original_url_not_a_url. "not-a-url" genuinely fails
        // the URL check; a scheme such as "htp:/broken" would not.
        { ...makeJob("Broken Link Role"), original_url: "not-a-url" },
      ],
      errors: [],
      warnings: [],
    };
  },
};

describe("the trace table, read back with raw SQL, answers the funnel questions", () => {
  let dir: string;
  let db: PipelineDb;
  let url: string;
  let runIdAlpha: string;
  let runIdBeta: string;
  let reportAlpha: CollectionReport;

  beforeAll(async () => {
    const temp = createDb("pipeline-trace-proof-");
    dir = temp.dir;
    url = temp.url;
    const built = buildWriter(url);
    db = built.db;
    runIdAlpha = "run-alpha";
    runIdBeta = "run-beta";

    // Two runs against the one scratch database, so a query grouped by run
    // id has more than one run to separate.
    reportAlpha = await runCollection({
      settings: stubSettings,
      runId: runIdAlpha,
      trace: built.writer,
      collectors: [adzunaCollector, greenhouseCollector],
      log: () => {},
    });
    await runCollection({
      settings: stubSettings,
      runId: runIdBeta,
      trace: built.writer,
      collectors: [adzunaCollector, greenhouseCollector],
      log: () => {},
    });
  }, CREATE_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("grouped by collector, each count is the number of jobs that collector produced", async () => {
    // DISTINCT job_id, because a dropped job carries both a collected and an
    // abandoned row; counting rows instead of jobs would double it.
    const rows = await queryTrace(
      url,
      "SELECT collector, COUNT(DISTINCT job_id) as count FROM Trace WHERE run_id = ? GROUP BY collector",
      [runIdAlpha]
    );
    const counts = Object.fromEntries(
      rows.map((row) => [row["collector"] as string, Number(row["count"])])
    );
    // adzuna's collector produced 3 jobs (2 kept, 1 dropped); greenhouse's
    // produced 2 (1 kept, 1 dropped).
    expect(counts).toEqual({ adzuna: 3, greenhouse: 2 });
  });

  test("grouped by run id and collector, each run's counts stay separate", async () => {
    const rows = await queryTrace(
      url,
      "SELECT run_id, collector, COUNT(DISTINCT job_id) as count FROM Trace GROUP BY run_id, collector ORDER BY run_id, collector",
      []
    );
    const totals = rows.map((row) => ({
      run_id: row["run_id"],
      collector: row["collector"],
      count: Number(row["count"]),
    }));
    expect(totals).toEqual([
      { run_id: runIdAlpha, collector: "adzuna", count: 3 },
      { run_id: runIdAlpha, collector: "greenhouse", count: 2 },
      { run_id: runIdBeta, collector: "adzuna", count: 3 },
      { run_id: runIdBeta, collector: "greenhouse", count: 2 },
    ]);
  });

  test("every row written during one run carries that run's id, and no other run's", async () => {
    const rows = await queryTrace(
      url,
      "SELECT run_id, COUNT(*) as count FROM Trace GROUP BY run_id ORDER BY run_id",
      []
    );
    const totals = rows.map((row) => ({ run_id: row["run_id"], count: Number(row["count"]) }));
    // Each run writes a collected event for every job its collectors
    // produced (3 + 2 = 5) plus an abandoned event for each of the two
    // dropped jobs: 7 rows. If any event carried the wrong run's id, these
    // groups would split into more than two, or their counts would drift
    // away from 7.
    expect(totals).toEqual([
      { run_id: runIdAlpha, count: 7 },
      { run_id: runIdBeta, count: 7 },
    ]);
  });

  test("a kept job's trace row carries the same id as its entry in report.jobs", async () => {
    const rows = await queryTrace(
      url,
      "SELECT job_id, collector FROM Trace WHERE run_id = ? AND event = ?",
      [runIdAlpha, "collected"]
    );
    const collectorByJobId = new Map(
      rows.map((row) => [row["job_id"] as string, row["collector"] as string])
    );
    expect(reportAlpha.jobs).toHaveLength(3);
    for (const job of reportAlpha.jobs) {
      expect(job.id).toBeDefined();
      expect(collectorByJobId.get(job.id as string)).toBe(job.collector);
    }
  });

  test("the detail column reads back as JSON text, not the bare string that was written", async () => {
    const [row] = await queryTrace(
      url,
      "SELECT detail FROM Trace WHERE run_id = ? AND collector = ? AND event = ?",
      [runIdAlpha, "greenhouse", "abandoned"]
    );
    // The orchestrator wrote the bare string "not-a-url", but detail is a
    // Json column, so raw SQL hands it back quoted rather than plain.
    expect(row?.["detail"]).toBe('"not-a-url"');
  });

  test("parsing that text recovers the value the orchestrator wrote", async () => {
    const [row] = await queryTrace(
      url,
      "SELECT detail FROM Trace WHERE run_id = ? AND collector = ? AND event = ?",
      [runIdAlpha, "greenhouse", "abandoned"]
    );
    const raw = row?.["detail"];
    expect(typeof raw).toBe("string");
    expect(JSON.parse(raw as string)).toBe("not-a-url");
  });
});
