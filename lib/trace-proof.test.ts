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
import { runCollection, type CollectionReport } from "./steps/search-orchestrator";
import type { Collector } from "./collectors/types";
import type { JobListEntry } from "./job-list-entry";
import type { SettingsService } from "./settings-service";
import { fakeSettings } from "./settings-service.fake";
import { fakeCompanyService } from "./company-service.fake";

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
const stubSettings: SettingsService = fakeSettings();

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
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: runIdAlpha,
      trace: built.writer,
      collectors: [adzunaCollector, greenhouseCollector],
      log: () => {},
    });
    await runCollection({
      companies: fakeCompanyService([]),
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
    // Each run writes a collected event for every job its collectors produced
    // (3 + 2 = 5), an abandoned event for each of the two dropped jobs, two
    // normalization events for each of the three that survived — one for the
    // title, one for the company name — and one association event per
    // surviving job: 5 + 2 + 6 + 3 = 16 rows. If any event carried the wrong
    // run's id, these groups would split into more than two, or their counts
    // would drift away from 16.
    expect(totals).toEqual([
      { run_id: runIdAlpha, count: 16 },
      { run_id: runIdBeta, count: 16 },
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

// A real vocabulary, so some titles genuinely normalize and some genuinely
// do not. The describe above stays on stubSettings, whose four title getters
// all return [], so nothing there ever exercises this path.
const vocabularySettings: SettingsService = fakeSettings({
  getTitleHeadNouns: async () => ["designer"],
  getTitleLevels: async () => [{ store: "Sr.", match: ["senior"] }],
  getTitleSuffixes: async () => [],
  getTitleRemovalWords: async () => [],
});

// Three jobs, only one of which carries "designer" in its title, so this
// collector's normalized and not-normalized counts land on different
// numbers than the other collector's.
const indeedCollector: Collector = {
  name: "indeed",
  async collect() {
    return {
      jobs: [
        makeJob("Senior Designer"),
        makeJob("Growth Marketer"),
        makeJob("Support Specialist"),
      ],
      errors: [],
      warnings: [],
    };
  },
};

// Four jobs, two carrying "designer". A different job count and a different
// split from indeed's, so a query that ignores the collector column and
// lumps every row together could not land on either collector's numbers.
const linkedinCollector: Collector = {
  name: "linkedin",
  async collect() {
    return {
      jobs: [
        makeJob("Product Designer"),
        makeJob("Staff Designer"),
        makeJob("UX Researcher"),
        makeJob("Data Analyst"),
      ],
      errors: [],
      warnings: [],
    };
  },
};

describe("with a real title vocabulary, the trace table answers how many titles normalized, by collector", () => {
  let dir: string;
  let db: PipelineDb;
  let url: string;
  let runId: string;

  beforeAll(async () => {
    const temp = createDb("pipeline-trace-proof-normalization-");
    dir = temp.dir;
    url = temp.url;
    const built = buildWriter(url);
    db = built.db;
    runId = "run-gamma";

    await runCollection({
      companies: fakeCompanyService([]),
      settings: vocabularySettings,
      runId,
      trace: built.writer,
      collectors: [indeedCollector, linkedinCollector],
      log: () => {},
    });
  }, CREATE_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("the headline question: how many titles normalized, by collector", async () => {
    const rows = await queryTrace(
      url,
      "SELECT collector, COUNT(*) as count FROM Trace WHERE run_id = ? AND reason = 'title_normalized' GROUP BY collector",
      [runId]
    );
    const counts = Object.fromEntries(
      rows.map((row) => [row["collector"] as string, Number(row["count"])])
    );
    // indeed: only "Senior Designer" carries the head noun. linkedin:
    // "Product Designer" and "Staff Designer" both do.
    expect(counts).toEqual({ indeed: 1, linkedin: 2 });
  });

  test("its twin: how many titles did not normalize, by collector", async () => {
    const rows = await queryTrace(
      url,
      "SELECT collector, COUNT(*) as count FROM Trace WHERE run_id = ? AND reason = 'title_not_normalized' GROUP BY collector",
      [runId]
    );
    const counts = Object.fromEntries(
      rows.map((row) => [row["collector"] as string, Number(row["count"])])
    );
    // indeed: "Growth Marketer" and "Support Specialist" carry no head noun.
    // linkedin: "UX Researcher" and "Data Analyst" carry none either.
    expect(counts).toEqual({ indeed: 2, linkedin: 2 });
  });

  test("normalized and not-normalized together account for every job that carried a title", async () => {
    const rows = await queryTrace(
      url,
      "SELECT collector, COUNT(*) as count FROM Trace WHERE run_id = ? AND (reason = 'title_normalized' OR reason = 'title_not_normalized') GROUP BY collector",
      [runId]
    );
    const counts = Object.fromEntries(
      rows.map((row) => [row["collector"] as string, Number(row["count"])])
    );
    // indeed: 1 normalized + 2 not normalized = 3, its whole job count.
    // linkedin: 2 normalized + 2 not normalized = 4, its whole job count.
    expect(counts).toEqual({ indeed: 3, linkedin: 4 });
  });

  test("a funnel in one query: every reason, grouped by collector, at the normalization step", async () => {
    const rows = await queryTrace(
      url,
      "SELECT collector, reason, COUNT(*) as count FROM Trace WHERE run_id = ? AND step = 'post_collection_normalization' GROUP BY collector, reason ORDER BY collector, reason",
      [runId]
    );
    const funnel = rows.map((row) => ({
      collector: row["collector"],
      reason: row["reason"],
      count: Number(row["count"]),
    }));
    // Every one of the 3 + 4 = 7 surviving jobs writes a company_name_normalized
    // row alongside its title row, so each collector's company count equals
    // its job count.
    expect(funnel).toEqual([
      { collector: "indeed", reason: "company_name_normalized", count: 3 },
      { collector: "indeed", reason: "title_normalized", count: 1 },
      { collector: "indeed", reason: "title_not_normalized", count: 2 },
      { collector: "linkedin", reason: "company_name_normalized", count: 4 },
      { collector: "linkedin", reason: "title_normalized", count: 2 },
      { collector: "linkedin", reason: "title_not_normalized", count: 2 },
    ]);
  });

  test("the step column separates the normalization pass from the collection pass", async () => {
    const rows = await queryTrace(
      url,
      "SELECT step, COUNT(*) as count FROM Trace WHERE run_id = ? GROUP BY step ORDER BY step",
      [runId]
    );
    const totals = rows.map((row) => ({ step: row["step"], count: Number(row["count"]) }));
    // collection writes one "collected" row per job handed over, and none of
    // the 3 + 4 = 7 jobs here fails the usability check, so that step has no
    // abandoned rows to add: 7. Normalization writes two rows per surviving
    // job, one for the title and one for the company name: 7 * 2 = 14.
    // Association writes one row per surviving job: 7. The steps sort
    // alphabetically, which puts association before normalization.
    expect(totals).toEqual([
      { step: "collection", count: 7 },
      { step: "post_collection_association", count: 7 },
      { step: "post_collection_normalization", count: 14 },
    ]);
  });

  test("a title_normalized row's detail round-trips as JSON holding the raw title and the normalized one", async () => {
    // indeed carries exactly one title_normalized row, so filtering on
    // collector, event and reason together, with no job id needed, lands on
    // "Senior Designer" alone.
    const [row] = await queryTrace(
      url,
      "SELECT detail FROM Trace WHERE run_id = ? AND collector = ? AND event = ? AND reason = ?",
      [runId, "indeed", "job_updated", "title_normalized"]
    );
    const raw = row?.["detail"];
    expect(typeof raw).toBe("string");
    // The reason is driven by whether a head noun matched, not by whether the
    // text changed, so "Product Designer" is title_normalized while reading
    // back identical. This one carries a level word too, so from and to
    // genuinely differ.
    expect(JSON.parse(raw as string)).toEqual({ from: "Senior Designer", to: "Sr. Designer" });
  });
});
