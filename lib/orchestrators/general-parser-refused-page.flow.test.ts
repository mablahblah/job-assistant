// Flow test: A refused page falls back to the collector.
//
// Three jobs wait in the backlog, and no dedicated parser claims any of them:
//
// - One whose page refuses the request, and whose collector supplied a place.
// - One whose page refuses the request, on another website, and whose
//   collector's only location is the word "Remote".
// - One that reached parsing with no link at all, and whose collector
//   supplied a place.
//
// A job search reads them, and the test checks what each job holds, which
// pages were asked for, and the parsing lines of the summary.
//
// Real services run against a scratch database. The websites are a local
// stand-in server, so nothing here reaches a real website.
//
// Covers: A refused page never expires a job, A job with a location is marked
// read, A job with a location stays in the backlog, A job with no location is
// set aside, "Remote" alone is not a place, A missing location has its own
// reason, No fetch for a job with no link, The summary counts jobs read, The
// summary counts jobs not read, The summary names the websites behind unread
// jobs, A job with no location counts as not read.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPipelineDb } from "../db/pipeline-db";
import { createAtsSlugService } from "../services/ats-slug-service";
import { createCompanyService } from "../services/company-service";
import { createJobService } from "../services/job-service";
import { createSettingsService } from "../services/settings-service";
import { createTraceService } from "../services/trace-service";
import { fakePlaceService } from "../services/place-service.fake";
import { fakeGeocoder } from "../tools/geocoder.fake";
import { fakePageFetcher } from "../tools/page-fetcher.fake";
import type {
  ResolutionBrowserFactory,
  ResolutionPage,
  ResolutionResponse,
} from "../tools/resolution-page";
import { saveJobs } from "../handlers/save";
import { summaryFromTraceCounts } from "../utils/run-summary";
import { runJobSearch } from "./job-search";
import { createLastSuccessService } from "../services/last-success-service";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and a job search runs after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const RUN_ID = "run-refused-page";

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Every reason the pipeline already records at parsing, and the one every
// age-based expiry carries. A missing location's reason must be none of these.
const EXISTING_REASONS = [
  "no_parser_for_domain",
  "parser_errored",
  "nothing_parsed",
  "past_expiration_threshold",
];

const PLACED = { id: "job-placed", host: "careers.tallpine.example", path: "/roles/12" };
const REMOTE_ONLY = { id: "job-remote-only", host: "jobs.redcliff.example", path: "/openings/7" };
const NO_LINK = { id: "job-no-link" };

// The website the summary names for the job that could not be read.
const REMOTE_ONLY_WEBSITE = "redcliff.example";

const REFUSED = { status: 403, body: "<html><body>Access denied</body></html>" };

const sites = fakePageFetcher({
  [`${PLACED.host}${PLACED.path}`]: REFUSED,
  [`${REMOTE_ONLY.host}${REMOTE_ONLY.path}`]: REFUSED,
});

const linkTo = (job: { host: string; path: string }) => `http://${job.host}:${sites.port()}${job.path}`;

// A browser that stays wherever it is sent. The stored jobs arrive already
// followed to their posting, so link-following never needs a real one.
function browserThatStaysPut(): ResolutionBrowserFactory {
  return async () => ({
    openPage: async () => {
      let current = "about:blank";
      const page: ResolutionPage = {
        async goto(url: string): Promise<ResolutionResponse> {
          current = url;
          return {
            status: () => 200,
            url: () => url,
            request: () => ({ isNavigationRequest: () => true }),
          };
        },
        url: () => current,
        content: async () => "<p>A job posting</p>",
        title: async () => "A job posting",
        $$eval: async (_selector, fn) => fn([]),
        on: () => {},
        off: () => {},
      };
      return { page, close: async () => {} };
    },
    close: async () => {},
  });
}

function runScript(script: string, url: string): void {
  const args = script === "db-create.ts" ? [url] : [];
  execFileSync("npx", ["tsx", `scripts/${script}`, ...args], {
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_DATABASE_URL: url },
    stdio: "pipe",
  });
}

// createPipelineDb reads the url at call time, so the environment holds the
// scratch value only for the moment of construction.
function connect(url: string): PipelineDb {
  const previous = process.env["PIPELINE_DATABASE_URL"];
  process.env["PIPELINE_DATABASE_URL"] = url;
  const db = createPipelineDb();
  if (previous === undefined) delete process.env["PIPELINE_DATABASE_URL"];
  else process.env["PIPELINE_DATABASE_URL"] = previous;
  return db;
}

// Answers every place lookup with the user's own city, so the location check
// passes every placed job and the run never reaches a mapping service.
const places = fakePlaceService([], {
  async findByText(text: string) {
    return {
      lookup_text: text,
      latitude: 30.2672,
      longitude: -97.7431,
      place_type: "city",
      display_name: "Austin, Texas",
      outline: null,
    };
  },
});

interface StoredJob {
  status: string;
  is_parsed: boolean;
}

describe("A refused page falls back to the collector", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  const jobs: Record<string, StoredJob | null> = {};
  const parsingReasons: Record<string, (string | null)[]> = {};
  let summary: string[];

  beforeAll(async () => {
    await sites.start();
    dir = mkdtempSync(join(tmpdir(), "pipeline-general-refused-page-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);
    const { company } = await companies.create({ name: "Tallpine" });

    const waiting = {
      raw_company_name: "Tallpine",
      company_id: company.id,
      collector: "adzuna",
      collected_at: RUN_AT,
      status: "backlog",
      is_resolved: true,
      is_parsed: false,
      is_classified: false,
    };
    const saved = await saveJobs(
      [
        {
          ...waiting,
          id: PLACED.id,
          original_url: linkTo(PLACED),
          resolved_url: linkTo(PLACED),
          raw_title: "Product Designer, Payments",
          raw_location_list: ["Austin, TX"],
        },
        {
          ...waiting,
          id: REMOTE_ONLY.id,
          original_url: linkTo(REMOTE_ONLY),
          resolved_url: linkTo(REMOTE_ONLY),
          raw_title: "Product Designer, Onboarding",
          raw_location_list: ["Remote"],
        },
        {
          ...waiting,
          id: NO_LINK.id,
          original_url: null,
          resolved_url: null,
          raw_title: "Product Designer, Reporting",
          raw_location_list: ["Austin, TX"],
        },
      ],
      {
        jobService,
        priorityList: await settings.getSourcePriorityList(),
        identifyingQueryValues: await settings.getIdentifyingQueryValues(),
      }
    );
    if (saved.jobs.length !== 3) {
      throw new Error(`the waiting jobs did not save: ${JSON.stringify(saved.warnings)}`);
    }

    globalThis.fetch = sites.fetch;

    const trace = createTraceService(db);
    await runJobSearch({
      settings,
      companies,
      lastSuccesses: createLastSuccessService(db),
      atsSlugs: createAtsSlugService(db),
      jobService,
      collectors: [],
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      launchParsingBrowser: sites.launchBrowser,
      places,
      geocoder: fakeGeocoder(),
      collectedAt: RUN_AT,
      runId: RUN_ID,
      trace,
      log: () => {},
    });

    for (const id of [PLACED.id, REMOTE_ONLY.id, NO_LINK.id]) {
      jobs[id] = await db.job.findUnique({ where: { id }, select: { status: true, is_parsed: true } });
      const rows = await db.trace.findMany({
        where: { run_id: RUN_ID, job_id: id, step: "parsing" },
        select: { reason: true },
      });
      parsingReasons[id] = rows.map((row) => row.reason);
    }
    summary = summaryFromTraceCounts(await trace.countsForRun(RUN_ID), [], null);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("A refused page never expires a job", () => {
    expect(jobs[PLACED.id]?.status).not.toBe("expired");
    expect(jobs[REMOTE_ONLY.id]?.status).not.toBe("expired");
    // The refused pages were asked for, so the outcome is the page's answer.
    expect(sites.visits.map((visit) => visit.path)).toEqual(
      expect.arrayContaining([PLACED.path, REMOTE_ONLY.path])
    );
  });

  test("A job with a location is marked read", () => {
    expect(jobs[PLACED.id]?.is_parsed).toBe(true);
    expect(jobs[NO_LINK.id]?.is_parsed).toBe(true);
  });

  test("A job with a location stays in the backlog", () => {
    expect(jobs[PLACED.id]?.status).toBe("backlog");
    expect(jobs[NO_LINK.id]?.status).toBe("backlog");
  });

  test("A job with no location is set aside", () => {
    expect(jobs[REMOTE_ONLY.id]?.status).toBe("unparseable");
  });

  test('"Remote" alone is not a place', () => {
    expect(jobs[REMOTE_ONLY.id]?.status).toBe("unparseable");
    expect(parsingReasons[REMOTE_ONLY.id]).toHaveLength(1);
    expect(EXISTING_REASONS).not.toContain(parsingReasons[REMOTE_ONLY.id]?.[0]);
  });

  test("A missing location has its own reason", () => {
    const reason = parsingReasons[REMOTE_ONLY.id]?.[0] ?? null;
    expect(reason).not.toBeNull();
    expect(EXISTING_REASONS).not.toContain(reason);
  });

  test("No fetch for a job with no link", () => {
    expect(jobs[NO_LINK.id]?.is_parsed).toBe(true);
    // Only the two refused pages were ever asked for.
    const asked = new Set(sites.visits.map((visit) => `${visit.host}${visit.path}`));
    expect([...asked].sort()).toEqual(
      [`${PLACED.host}${PLACED.path}`, `${REMOTE_ONLY.host}${REMOTE_ONLY.path}`].sort()
    );
  });

  test("The summary counts jobs read", () => {
    expect(summary).toContain("Parsed: 2 jobs");
  });

  test("The summary counts jobs not read", () => {
    expect(summary).toContain("  - 1 job could not be parsed");
  });

  test("The summary names the websites behind unread jobs", () => {
    const websiteLines = summary.filter((line) => line.startsWith("    - "));
    expect(websiteLines).toHaveLength(1);
    expect(websiteLines[0]).toMatch(
      new RegExp(`^    - ${REMOTE_ONLY_WEBSITE.replace(".", "\\.")}: 1 job \\(parser failed\\)$`)
    );
  });

  test("A job with no location counts as not read", () => {
    expect(summary).toContain("  - 1 job could not be parsed");
    expect(summary.join("\n")).toContain(REMOTE_ONLY_WEBSITE);
    expect(summary.join("\n")).not.toContain("tallpine.example");
  });
});
