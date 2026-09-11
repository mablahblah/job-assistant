// Runs a real job search through the real trace service against a scratch
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
import { createTraceService, type TraceService } from "./trace-service";
import { runJobSearch, type RunJobSearchResult } from "./orchestrators/job-search";
import { associateCompanies } from "./handlers/association";
import { saveJobs } from "./handlers/save";
import { createCompanyService } from "./company-service";
import { createJobService } from "./job-service";
import type { Collector } from "./collectors/types";
import type { ResolutionBrowserFactory, ResolutionBrowserSession } from "./resolution-page";
import { fakeResolutionPage } from "./resolution-page.fake";
import type { JobListEntry } from "./job-list-entry";
import type { SettingsService } from "./settings-service";
import { fakeSettingsService } from "./settings-service.fake";
import { fakeCompanyService } from "./company-service.fake";
import { fakeJobService } from "./job-service.fake";

// This file lives in lib/, so the repo root is one level up.
const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..");

// Creating a scratch database measured well under two seconds. This is a
// ceiling rather than a budget.
const CREATE_TIMEOUT_MS = 45_000;

// The date every run here stamps into collected_at. Fixed, so a row written
// by one of these runs never depends on when the suite happened to run.
const COLLECTED_AT = new Date("2026-09-01T10:00:00.000Z");

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
function buildWriter(url: string): { db: PipelineDb; writer: TraceService } {
  const previous = process.env["PIPELINE_DATABASE_URL"];
  process.env["PIPELINE_DATABASE_URL"] = url;
  const db = createPipelineDb();
  if (previous === undefined) delete process.env["PIPELINE_DATABASE_URL"];
  else process.env["PIPELINE_DATABASE_URL"] = previous;
  return { db, writer: createTraceService(db) };
}

async function cleanup(dir: string, db: PipelineDb): Promise<void> {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
}

// The orchestrator only reads settings through this interface; nothing under
// test here exercises any of these getters.
const stubSettings: SettingsService = fakeSettingsService();

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

// Three of the runs below ask a question about one collect-leg pass — how
// titles normalized, how jobs reached their companies, what save did — so they
// declare nothing left to resolve and take a browser that fails if anything
// asks it to launch. The two runs asserting a whole run's step list walk for
// real instead, because that claim covers both legs.
const NOTHING_TO_RESOLVE = { findUnresolved: async () => [] };

const FORBIDDEN_BROWSER = async (): Promise<ResolutionBrowserSession> => {
  throw new Error("the run launched a browser with nothing to resolve");
};

// Walks every job to an employer posting of its own, so each one resolves and
// no two land on the same URL for post-resolution dedupe to fold. The fake
// page ignores the URL it is handed and serves the next script in order, and
// these runs walk one job at a time, so script order is job order.
function browserServing(): ResolutionBrowserFactory {
  let served = 0;
  return async () => ({
    openPage: async () => {
      const url = `https://employer.example/posting/${served}`;
      served += 1;
      return {
        page: fakeResolutionPage([{ url, html: "<p>A job posting</p>" }]),
        close: async () => {},
      };
    },
    close: async () => {},
  });
}

// One job at a time, and a priority list real enough for save to rank the one
// collector these runs use.
const RESOLVING_SETTINGS: Partial<SettingsService> = {
  getResolutionConcurrency: async () => 1,
  getSourcePriorityList: async () => ["collector:user", "collector:adzuna"],
};

describe("the trace table, read back with raw SQL, answers the funnel questions", () => {
  let dir: string;
  let db: PipelineDb;
  let url: string;
  let runIdAlpha: string;
  let runIdBeta: string;
  let reportAlpha: RunJobSearchResult;

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
    reportAlpha = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], NOTHING_TO_RESOLVE),
      collectedAt: COLLECTED_AT,
      companies: fakeCompanyService([]),
      settings: stubSettings,
      runId: runIdAlpha,
      trace: built.writer,
      collectors: [adzunaCollector, greenhouseCollector],
      log: () => {},
    });
    await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: fakeJobService([], NOTHING_TO_RESOLVE),
      collectedAt: COLLECTED_AT,
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
    // title, one for the company name — one association event per surviving
    // job, and one save event per surviving job: 5 + 2 + 6 + 3 + 3 = 19 rows.
    // If any event carried the wrong run's id, these groups would split into
    // more than two, or their counts would drift away from 19.
    expect(totals).toEqual([
      { run_id: runIdAlpha, count: 19 },
      { run_id: runIdBeta, count: 19 },
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

    await runJobSearch({
      openBrowser: browserServing(),
      settle: async () => {},
      jobService: fakeJobService([]),
      collectedAt: COLLECTED_AT,
      companies: fakeCompanyService([]),
      settings: fakeSettingsService({
        getTitleHeadNouns: async () => ["designer"],
        getTitleLevels: async () => [{ store: "Sr.", match: ["senior"] }],
        getTitleSuffixes: async () => [],
        getTitleRemovalWords: async () => [],
        ...RESOLVING_SETTINGS,
      }),
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

  test("the step column separates every pass of the run from the others", async () => {
    const rows = await queryTrace(
      url,
      "SELECT step, COUNT(*) as count FROM Trace WHERE run_id = ? GROUP BY step ORDER BY step",
      [runId]
    );
    const totals = rows.map((row) => ({ step: row["step"], count: Number(row["count"]) }));
    // One run id covers both legs, so this is the whole pipeline's row set.
    //
    // The collect leg: collection writes one "collected" row per job handed
    // over, and none of the 3 + 4 = 7 jobs here fails the usability check, so
    // that step has no abandoned rows to add: 7. Normalization writes two rows
    // per surviving job, one for the title and one for the company name:
    // 7 * 2 = 14. Association writes one row per surviving job: 7. Save writes
    // one row per surviving job too: 7. Post-collection dedupe is absent
    // because no two of these seven jobs are the same job, and a job it passed
    // through untouched leaves no row.
    //
    // The resolution leg then finds all 7, because the collect leg saved them
    // with no source URL. Resolution writes one row per job walked: 7. Each
    // walk lands on an employer posting of its own, so no two jobs collide and
    // post-resolution dedupe writes nothing either. Save meets all 7 again: 7.
    //
    // The steps sort alphabetically, which puts association first and the
    // resolution walk last.
    expect(totals).toEqual([
      { step: "collection", count: 7 },
      { step: "post_collection_association", count: 7 },
      { step: "post_collection_normalization", count: 14 },
      { step: "post_collection_save", count: 7 },
      { step: "post_resolution_save", count: 7 },
      { step: "resolution", count: 7 },
    ]);
  });

  test("a run holding no duplicates leaves no dedupe rows at all", async () => {
    const rows = await queryTrace(
      url,
      "SELECT COUNT(*) as count FROM Trace WHERE run_id = ? AND step = 'post_collection_dedupe'",
      [runId]
    );

    expect(Number(rows[0]?.["count"])).toBe(0);
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

// Four jobs covering the three cases worth proving: two naming one employer
// nobody has yet, one whose slug lands on a company whose name is already
// taken by another, and one whose slug lands on a company still waiting for
// a name.
const associationCollector: Collector = {
  name: "lever",
  async collect() {
    return {
      jobs: [
        { ...makeJob("Product Designer"), raw_company_name: "Northwind Traders" },
        { ...makeJob("UX Researcher"), raw_company_name: "Northwind Traders" },
        { ...makeJob("Staff Writer"), raw_company_slug: "acme-boards", raw_company_name: "Acme" },
        {
          ...makeJob("Content Designer"),
          raw_company_slug: "fabrikam-boards",
          raw_company_name: "Fabrikam",
        },
      ],
      errors: [],
      warnings: [],
    };
  },
};

describe("the trace table answers how each job reached its company, across both passes", () => {
  let dir: string;
  let url: string;
  let db: PipelineDb;
  const runId = "run-association";

  beforeAll(async () => {
    const temp = createDb("pipeline-trace-association-");
    dir = temp.dir;
    url = temp.url;
    const built = buildWriter(url);
    db = built.db;
    const companies = createCompanyService(built.db);

    // Three companies exist before the run. "Acme" holds the name a later
    // job will try to write onto a different company, which is what makes
    // the clash real rather than contrived.
    await companies.create({ name: "Acme" });
    await companies.create({ ats_platform: "greenhouse", ats_slug: "acme-boards" });
    await companies.create({ ats_platform: "greenhouse", ats_slug: "fabrikam-boards" });

    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService: { ...createJobService(built.db), ...NOTHING_TO_RESOLVE },
      collectedAt: COLLECTED_AT,
      settings: stubSettings,
      runId,
      trace: built.writer,
      companies,
      collectors: [associationCollector],
      log: () => {},
    });

    // The step runs again after parsing in the real pipeline. Parsing is a
    // later phase, so the second pass is called directly here — the step
    // takes its own step name from its caller precisely so it can.
    await associateCompanies(report.jobs, {
      companies,
      trace: built.writer,
      runId,
      step: "post_parsing_association",
    });
  }, CREATE_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("counts the companies the run actually created, not the association attempts", async () => {
    // Association runs twice, but a company is only ever created on the
    // first pass — the second pass finds it already there and matches by
    // name instead of creating a second one. company_created is a reason
    // rather than an event, and the event beside it is company_associated.
    const rows = await queryTrace(
      url,
      "SELECT step FROM Trace WHERE run_id = ? AND event = 'company_associated' AND reason = 'company_created'",
      [runId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.["step"]).toBe("post_collection_association");
  });

  test("reads how each job reached its company from the newest row per job, not a flat count", async () => {
    // A flat count across both passes double-counts: job A alone contributes
    // a company_created row on pass one and a matched_by_name row on pass
    // two. Only the newest row per job reflects what actually happened,
    // since the second pass repeats association rather than reversing it.
    const rows = await queryTrace(
      url,
      "SELECT reason FROM Trace WHERE run_id = ? AND event = 'company_associated' AND id IN (SELECT MAX(id) FROM Trace WHERE run_id = ? AND event = 'company_associated' GROUP BY job_id)",
      [runId, runId]
    );
    expect(rows.length).toBe(4);
    const reasons = rows.map((row) => row["reason"]).sort();
    expect(reasons).toEqual([
      "matched_by_name",
      "matched_by_name",
      "matched_by_slug",
      "matched_by_slug",
    ]);
    expect(reasons).not.toContain("company_created");
  });

  test("collapses two jobs naming the same absent employer onto one company", async () => {
    // One of the two jobs creates the company; the other, collected under
    // the same raw name, matches the row the first one just made instead of
    // creating a second.
    const created = await queryTrace(
      url,
      "SELECT job_id FROM Trace WHERE run_id = ? AND event = 'company_associated' AND reason = 'company_created' AND detail = ?",
      [runId, JSON.stringify("Northwind Traders")]
    );
    expect(created.length).toBe(1);

    const associated = await queryTrace(
      url,
      "SELECT DISTINCT job_id FROM Trace WHERE run_id = ? AND event = 'company_associated' AND detail = ?",
      [runId, JSON.stringify("Northwind Traders")]
    );
    expect(associated.length).toBe(2);

    // Only one company by that name exists in the table, so the two jobs'
    // association rows above can only both be pointing at it.
    const company = await queryTrace(url, "SELECT id, ats_slug FROM Company WHERE name = ?", [
      "Northwind Traders",
    ]);
    expect(company.length).toBe(1);
    expect(company[0]?.["ats_slug"]).toBeNull();
  });

  test("records the name clash on both passes without ever retracting it", async () => {
    const rows = await queryTrace(
      url,
      "SELECT step, job_id, detail FROM Trace WHERE run_id = ? AND event = 'company_update_failed' AND reason = 'company_name_clash' ORDER BY id",
      [runId]
    );
    expect(rows.length).toBe(2);
    expect(rows[0]?.["step"]).toBe("post_collection_association");
    expect(rows[1]?.["step"]).toBe("post_parsing_association");
    // The clash sticks with the same job on both passes — a warning raised
    // once is never cleared by a later pass.
    expect(rows[0]?.["job_id"]).toBe(rows[1]?.["job_id"]);
    for (const row of rows) {
      const parsed = JSON.parse(String(row["detail"])) as string;
      expect(parsed).toBe("Acme");
    }
  });

  test("fills a company's missing name once, and never repeats the fill once it holds one", async () => {
    const filled = await queryTrace(
      url,
      "SELECT step, detail FROM Trace WHERE run_id = ? AND event = 'company_updated' AND reason = 'company_name_filled'",
      [runId]
    );
    expect(filled.length).toBe(1);
    expect(filled[0]?.["step"]).toBe("post_collection_association");
    const parsed = JSON.parse(String(filled[0]?.["detail"])) as string;
    expect(parsed).toBe("Fabrikam");

    // By the second pass the company already holds a name, so nothing is
    // overwritten and no second fill row is written.
    const secondPass = await queryTrace(
      url,
      "SELECT id FROM Trace WHERE run_id = ? AND step = 'post_parsing_association' AND event = 'company_updated'",
      [runId]
    );
    expect(secondPass.length).toBe(0);
  });
});

// Three jobs from one collector, each naming an employer nobody holds yet, so
// the run creates its companies and every job reaches a row.
const saveCollector: Collector = {
  name: "ashby",
  async collect() {
    return {
      jobs: [
        { ...makeJob("Product Designer"), raw_company_name: "Contoso" },
        { ...makeJob("UX Researcher"), raw_company_name: "Contoso" },
        { ...makeJob("Staff Designer"), raw_company_name: "Litware" },
      ],
      errors: [],
      warnings: [],
    };
  },
};

describe("the trace table answers what save did to each job, across both passes", () => {
  let dir: string;
  let url: string;
  let db: PipelineDb;
  const runId = "run-save";

  beforeAll(async () => {
    const temp = createDb("pipeline-trace-save-");
    dir = temp.dir;
    url = temp.url;
    const built = buildWriter(url);
    db = built.db;
    // Real services throughout, so the rows this asserts on sit behind real
    // Job and Company rows rather than objects in an array.
    const jobService = { ...createJobService(built.db), ...NOTHING_TO_RESOLVE };

    const report = await runJobSearch({
      openBrowser: FORBIDDEN_BROWSER,
      jobService,
      collectedAt: COLLECTED_AT,
      settings: stubSettings,
      runId,
      trace: built.writer,
      companies: createCompanyService(built.db),
      collectors: [saveCollector],
      log: () => {},
    });

    // Save runs again after parsing in the real pipeline. Parsing is a later
    // phase, so the second pass is called directly here, the way the second
    // association pass is. The same rows are met again, so this pass updates
    // where the first created.
    await saveJobs(report.jobs, {
      jobService,
      priorityList: [],
      trace: built.writer,
      runId,
      step: "post_parsing_save",
    });
  }, CREATE_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("counts the rows the run created, separately from the ones it updated", async () => {
    const rows = await queryTrace(
      url,
      "SELECT event, COUNT(*) as count FROM Trace WHERE run_id = ? AND event LIKE 'job_dbrow%' GROUP BY event ORDER BY event",
      [runId]
    );
    const counts = rows.map((row) => ({ event: row["event"], count: Number(row["count"]) }));
    // The first pass writes three rows and creates each one. The second pass
    // meets the same three and merges over them.
    expect(counts).toEqual([
      { event: "job_dbrow_created", count: 3 },
      { event: "job_dbrow_updated", count: 3 },
    ]);
  });

  test("the step column tells the two save passes apart", async () => {
    const rows = await queryTrace(
      url,
      "SELECT step, COUNT(*) as count FROM Trace WHERE run_id = ? AND event LIKE 'job_dbrow%' GROUP BY step ORDER BY step",
      [runId]
    );
    const counts = rows.map((row) => ({ step: row["step"], count: Number(row["count"]) }));
    expect(counts).toEqual([
      { step: "post_collection_save", count: 3 },
      { step: "post_parsing_save", count: 3 },
    ]);
  });

  test("every job the run collected reached a row", async () => {
    // Every job that entered at collection has a save row naming it, which is
    // what makes the funnel add up: nothing entered and quietly vanished.
    const collected = await queryTrace(
      url,
      "SELECT DISTINCT job_id FROM Trace WHERE run_id = ? AND event = 'collected'",
      [runId]
    );
    const saved = await queryTrace(
      url,
      "SELECT DISTINCT job_id FROM Trace WHERE run_id = ? AND event = 'job_dbrow_created'",
      [runId]
    );

    expect(saved.length).toBe(collected.length);
    expect(saved.map((row) => row["job_id"]).sort()).toEqual(
      collected.map((row) => row["job_id"]).sort()
    );
  });

  test("a save row's job id names a job row that really exists", async () => {
    // The proof that a caller-supplied id survives the write: the id the
    // trace names is the id the Job table holds, so a job's history and its
    // row can be joined.
    const rows = await queryTrace(
      url,
      "SELECT COUNT(*) as count FROM Trace WHERE run_id = ? AND event = 'job_dbrow_created' AND job_id NOT IN (SELECT id FROM Job)",
      [runId]
    );

    expect(Number(rows[0]?.["count"])).toBe(0);
  });

  test("every saved row carries the collection date the caller stamped", async () => {
    const rows = await queryTrace(url, "SELECT DISTINCT collected_at FROM Job", []);

    expect(rows.length).toBe(1);
    expect(new Date(String(rows[0]?.["collected_at"])).toISOString()).toBe(
      COLLECTED_AT.toISOString()
    );
  });
});

// Three jobs from one collector, two of them the same posting reached twice.
// The pair shares a link, which is the strongest identity clause, so dedupe
// folds them whatever else they carry.
const dedupeCollector: Collector = {
  name: "adzuna",
  async collect() {
    return {
      jobs: [
        { ...makeJob("Product Designer"), raw_company_name: "Fabrikam" },
        { ...makeJob("Product Designer"), raw_company_name: "Fabrikam" },
        { ...makeJob("UX Researcher"), raw_company_name: "Fabrikam" },
      ],
      errors: [],
      warnings: [],
    };
  },
};

describe("the trace table answers what dedupe merged away, and what save then did with it", () => {
  let dir: string;
  let url: string;
  let db: PipelineDb;
  let report: RunJobSearchResult;
  const runId = "run-dedupe";

  beforeAll(async () => {
    const temp = createDb("pipeline-trace-dedupe-");
    dir = temp.dir;
    url = temp.url;
    const built = buildWriter(url);
    db = built.db;

    // Real services throughout, so the rows this asserts on sit behind real
    // Job and Company rows rather than objects in an array.
    report = await runJobSearch({
      openBrowser: browserServing(),
      settle: async () => {},
      jobService: createJobService(built.db),
      collectedAt: COLLECTED_AT,
      settings: fakeSettingsService(RESOLVING_SETTINGS),
      runId,
      trace: built.writer,
      companies: createCompanyService(built.db),
      collectors: [dedupeCollector],
      log: () => {},
    });
  }, CREATE_TIMEOUT_MS);

  afterAll(() => cleanup(dir, db));

  test("dedupe joins the step list, writing one row for the entry it merged away", async () => {
    const rows = await queryTrace(
      url,
      "SELECT step, COUNT(*) as count FROM Trace WHERE run_id = ? GROUP BY step ORDER BY step",
      [runId]
    );
    const totals = rows.map((row) => ({ step: row["step"], count: Number(row["count"]) }));

    // The collect leg: all three jobs are usable, so collection writes 3 and
    // normalization writes 2 rows each: 6. Association writes one per job: 3.
    // Dedupe folds the pair and writes one row, for the entry that left. Save
    // meets all three entries the step handed back — two survivors it creates,
    // and the marked loser it can find no row for: 3.
    //
    // The resolution leg then finds 2 rather than 3, which is the whole point
    // of reading its list out of the database: the folded duplicate never
    // became a row, so there is nothing to walk for it. Resolution writes one
    // row per job walked: 2. Both land on postings of their own, so
    // post-resolution dedupe writes nothing. Save meets both again: 2.
    expect(totals).toEqual([
      { step: "collection", count: 3 },
      { step: "post_collection_association", count: 3 },
      { step: "post_collection_dedupe", count: 1 },
      { step: "post_collection_normalization", count: 6 },
      { step: "post_collection_save", count: 3 },
      { step: "post_resolution_save", count: 2 },
      { step: "resolution", count: 2 },
    ]);
  });

  test("the merged-away entry reads abandoned on a hard match", async () => {
    const [row] = await queryTrace(
      url,
      "SELECT event, reason FROM Trace WHERE run_id = ? AND step = 'post_collection_dedupe'",
      [runId]
    );

    expect(row?.["event"]).toBe("abandoned");
    // Neither copy carries a posting date, so their pooled dates land on the
    // same value and the gap between them is nothing at all.
    expect(row?.["reason"]).toBe("hard_match_in_list");
  });

  test("its detail round-trips as JSON naming the job it became and the clause", async () => {
    const [row] = await queryTrace(
      url,
      "SELECT detail FROM Trace WHERE run_id = ? AND step = 'post_collection_dedupe'",
      [runId]
    );
    const detail = JSON.parse(String(row?.["detail"])) as Record<string, string>;

    expect(detail["clause"]).toBe("original_url");
    expect(detail["company"]).toBe("Fabrikam");
    // The id it became belongs to a job the run kept, which is what lets the
    // pair be drawn as one hop rather than a dead end.
    expect(report.jobs.map((job) => job.id)).toContain(detail["became"]);
  });

  test("save records the same reason for the entry it could find no row for", async () => {
    const [row] = await queryTrace(
      url,
      "SELECT event, reason FROM Trace WHERE run_id = ? AND step = 'post_collection_save' AND event = 'abandoned'",
      [runId]
    );

    expect(row?.["event"]).toBe("abandoned");
    // The reason names the match that removed the job rather than the write
    // that never happened, so deletions can be counted by kind.
    expect(row?.["reason"]).toBe("hard_match_in_list");
  });

  test("the pair left one row in the job table, not two", async () => {
    const rows = await queryTrace(url, "SELECT COUNT(*) as count FROM Job", []);

    expect(Number(rows[0]?.["count"])).toBe(2);
  });
});
