// Flow test: A dedicated parser's failure hands the job on.
//
// Three jobs wait in the backlog on Ashby, which has a dedicated parser, each
// already followed to its posting and each on its own board. Ashby's data
// feed fails each one a different way: one board answers a server error, one
// answers with the posting missing, so the parser reads nothing, and one
// answers "not found". Every job's own page still shows the posting and
// publishes search-engine job data. A job search reads them, and the test
// checks what each job holds afterwards.
//
// Real services run against a scratch database. Ashby and the job pages are a
// local stand-in server, so nothing here reaches a real website.
//
// Covers: A dedicated parser's error sends the job on, A dedicated parser's
// empty read sends the job on, Only the page decides dead, Each job leaves
// parsing once.
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
import { fakePageFetcher, type SitePages } from "../tools/page-fetcher.fake";
import type {
  ResolutionBrowserFactory,
  ResolutionPage,
  ResolutionResponse,
} from "../tools/resolution-page";
import { saveJobs } from "../handlers/save";
import { runJobSearch } from "./job-search";
import { createLastSuccessService } from "../services/last-success-service";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and a job search runs after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const RUN_ID = "run-second-try";

type PipelineDb = ReturnType<typeof createPipelineDb>;

// One job per way Ashby's data feed fails. Each sits on a board of its own,
// because the feed answers per board.
interface FailedJob {
  name: string;
  board: string;
  feed: { status: number; body: string };
  description: string;
}

const FAILED_JOBS: FailedJob[] = [
  {
    name: "parser errors",
    board: "brightline-outage",
    feed: { status: 500, body: '{"error":"internal"}' },
    description: "Design the dispatch console for Brightline's field crews.",
  },
  {
    name: "parser reads nothing",
    board: "brightline-moved",
    feed: { status: 200, body: '{"apiVersion":"1","jobs":[]}' },
    description: "Own the onboarding flow for Brightline's new customers.",
  },
  {
    name: "feed says not found",
    board: "brightline-hidden",
    feed: { status: 404, body: '{"error":"not found"}' },
    description: "Shape the reporting tools Brightline's analysts use daily.",
  },
];

const POSTING_ID = "7d0c1a2b-3e4f-4a5b-8c6d-9e0f1a2b3c4d";

const idFor = (job: FailedJob) => `job-${job.board}`;
const linkFor = (job: FailedJob) => `https://jobs.ashbyhq.com/${job.board}/${POSTING_ID}`;

function jobDataPage(description: string): string {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Product Designer",
    datePosted: "2026-08-20",
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: "Austin", addressRegion: "TX" },
    },
    description: `<p>${description}</p>`,
  };
  return (
    "<!DOCTYPE html><html><head><title>Careers</title>" +
    `<script type="application/ld+json">${JSON.stringify(block)}</script>` +
    `</head><body><p>${description}</p></body></html>`
  );
}

const pages: SitePages = {};
for (const job of FAILED_JOBS) {
  pages[`api.ashbyhq.com/posting-api/job-board/${job.board}?includeCompensation=true`] = {
    status: job.feed.status,
    contentType: "application/json",
    body: job.feed.body,
  };
  pages[`jobs.ashbyhq.com/${job.board}/${POSTING_ID}`] = { body: jobDataPage(job.description) };
}
const sites = fakePageFetcher(pages);

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
// passes every job and the run never reaches a mapping service.
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
  description: string | null;
  posting_date: Date | null;
}

describe("A dedicated parser's failure hands the job on", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  const jobs: Record<string, StoredJob | null> = {};
  const parsingRows: Record<string, number> = {};

  beforeAll(async () => {
    await sites.start();
    dir = mkdtempSync(join(tmpdir(), "pipeline-general-second-try-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);
    const { company } = await companies.create({ name: "Brightline" });

    const saved = await saveJobs(
      FAILED_JOBS.map((job) => ({
        id: idFor(job),
        original_url: linkFor(job),
        resolved_url: linkFor(job),
        // A title of its own, so duplicate matching, which treats one
        // employer's same title as one job, never folds two cases together.
        raw_title: `Product Designer, ${job.name}`,
        raw_company_name: "Brightline",
        company_id: company.id,
        raw_location_list: ["Austin, TX"],
        collector: "adzuna",
        collected_at: RUN_AT,
        status: "backlog",
        is_resolved: true,
        is_parsed: false,
        is_classified: false,
      })),
      {
        jobService,
        priorityList: await settings.getSourcePriorityList(),
        identifyingQueryValues: await settings.getIdentifyingQueryValues(),
      }
    );
    if (saved.jobs.length !== FAILED_JOBS.length) {
      throw new Error(`the waiting jobs did not save: ${JSON.stringify(saved.warnings)}`);
    }

    globalThis.fetch = sites.fetch;

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
      trace: createTraceService(db),
      log: () => {},
    });

    for (const job of FAILED_JOBS) {
      jobs[job.name] = await db.job.findUnique({
        where: { id: idFor(job) },
        select: { status: true, description: true, posting_date: true },
      });
      parsingRows[job.name] = await db.trace.count({
        where: { run_id: RUN_ID, job_id: idFor(job), step: "parsing" },
      });
    }
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const job = (name: string) => FAILED_JOBS.find((candidate) => candidate.name === name)!;

  test("A dedicated parser's error sends the job on", () => {
    const errored = job("parser errors");
    expect(jobs[errored.name]?.description ?? "").toContain(errored.description);
    expect(jobs[errored.name]?.posting_date?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  test("A dedicated parser's empty read sends the job on", () => {
    const empty = job("parser reads nothing");
    expect(jobs[empty.name]?.description ?? "").toContain(empty.description);
    expect(jobs[empty.name]?.posting_date?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  test("Only the page decides dead", () => {
    const hidden = job("feed says not found");
    expect(jobs[hidden.name]?.description ?? "").toContain(hidden.description);
    for (const each of FAILED_JOBS) {
      expect(jobs[each.name]?.status, each.name).not.toBe("expired");
    }
  });

  test("Each job leaves parsing once", () => {
    for (const each of FAILED_JOBS) {
      expect(parsingRows[each.name], each.name).toBe(1);
    }
  });
});
