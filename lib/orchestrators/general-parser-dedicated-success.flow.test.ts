// Flow test: A dedicated parser's success ends parsing.
//
// Three jobs wait in the backlog, each already followed to its posting, and a
// dedicated parser reads every one:
//
// - A Lever job, whose data feed answers in full.
// - A job on an employer's own careers website whose link carries a
//   Greenhouse job number, which the Greenhouse parser recognises.
// - A Lever job whose posting says "remote" and names no place.
//
// A job search reads them, and the test checks which parser read each job,
// that the general parser never opened any job's own page, and that the
// "remote" job is judged the way it was before the general parser existed.
//
// Real services run against a scratch database. Lever, Greenhouse and the
// employer's website are a local stand-in server, so nothing here reaches a
// real website.
//
// Covers: A dedicated parser's success ends parsing, Greenhouse keeps the
// employer links it recognises, Dedicated-parser jobs keep today's location
// rule.
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
import { runJobSearch } from "./job-search";
import { createLastSuccessService } from "../services/last-success-service";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and a job search runs after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const RUN_ID = "run-dedicated-success";

type PipelineDb = ReturnType<typeof createPipelineDb>;

const LEVER_BOARD = "northwind";
const LEVER_POSTING = "5b1e2f3a-4c5d-4e6f-8a7b-9c0d1e2f3a4b";
const REMOTE_POSTING = "6c2f3a4b-5d6e-4f7a-9b8c-0d1e2f3a4b5c";
const LEVER_DESCRIPTION = "Design the care-team dashboard nurses use on every shift.";
const REMOTE_DESCRIPTION = "Lead research for Northwind's remote patient tools.";

const GREENHOUSE_BOARD = "harborview";
const GREENHOUSE_JOB_ID = "4455667";
const GREENHOUSE_DESCRIPTION = "Shape the booking flow Harborview's guests start from.";

const JOBS = {
  lever: {
    id: "job-lever",
    link: `https://jobs.lever.co/${LEVER_BOARD}/${LEVER_POSTING}`,
    pagePath: `/${LEVER_BOARD}/${LEVER_POSTING}`,
  },
  employerSite: {
    id: "job-employer-site",
    link: `https://careers.harborview.example/open-roles?gh_jid=${GREENHOUSE_JOB_ID}`,
    pagePath: `/open-roles?gh_jid=${GREENHOUSE_JOB_ID}`,
  },
  remote: {
    id: "job-remote",
    link: `https://jobs.lever.co/${LEVER_BOARD}/${REMOTE_POSTING}`,
    pagePath: `/${LEVER_BOARD}/${REMOTE_POSTING}`,
  },
};

const json = (body: unknown) => ({ contentType: "application/json", body: JSON.stringify(body) });

// Each job's own page publishes job data too, so a general parser that read
// it would change the job, and the visit would be recorded either way.
const OWN_PAGE = {
  body:
    '<!DOCTYPE html><html><head><script type="application/ld+json">' +
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      description: "<p>Read from the job's own page.</p>",
    }) +
    "</script></head><body><p>Read from the job's own page.</p></body></html>",
};

const sites = fakePageFetcher({
  // Lever's data feed, and the board page its parser reads the employer from.
  [`api.lever.co/v0/postings/${LEVER_BOARD}/${LEVER_POSTING}`]: json({
    id: LEVER_POSTING,
    text: "Product Designer, Care Teams",
    createdAt: Date.parse("2026-08-20T00:00:00.000Z"),
    categories: { location: "Austin, TX" },
    workplaceType: "onsite",
    descriptionPlain: LEVER_DESCRIPTION,
  }),
  [`api.lever.co/v0/postings/${LEVER_BOARD}/${REMOTE_POSTING}`]: json({
    id: REMOTE_POSTING,
    text: "Senior UX Researcher",
    createdAt: Date.parse("2026-08-20T00:00:00.000Z"),
    categories: {},
    workplaceType: "remote",
    descriptionPlain: REMOTE_DESCRIPTION,
  }),
  [`jobs.lever.co/${LEVER_BOARD}`]: { body: "<html><head><title>Northwind Health</title></head></html>" },
  [`jobs.lever.co${JOBS.lever.pagePath}`]: OWN_PAGE,
  [`jobs.lever.co${JOBS.remote.pagePath}`]: OWN_PAGE,

  // Greenhouse turns a job number into its board by redirecting its embed
  // address to one naming the board, then answers from its data feed.
  [`boards.greenhouse.io/embed/job_app?token=${GREENHOUSE_JOB_ID}`]: {
    redirectTo: `https://boards.greenhouse.io/embed/job_app?for=${GREENHOUSE_BOARD}&token=${GREENHOUSE_JOB_ID}`,
  },
  [`boards.greenhouse.io/embed/job_app?for=${GREENHOUSE_BOARD}&token=${GREENHOUSE_JOB_ID}`]: {
    body: "<html><body>Apply</body></html>",
  },
  [`boards-api.greenhouse.io/v1/boards/${GREENHOUSE_BOARD}/jobs/${GREENHOUSE_JOB_ID}?content=true&pay_transparency=true`]:
    json({
      id: Number(GREENHOUSE_JOB_ID),
      title: "Product Designer, Bookings",
      first_published: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
      location: { name: "Austin, TX" },
      content: `<p>${GREENHOUSE_DESCRIPTION}</p>`,
      company_name: "Harborview",
    }),
  [`careers.harborview.example${JOBS.employerSite.pagePath}`]: OWN_PAGE,
});

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
  parser: string | null;
  description: string | null;
  is_classified: boolean;
  location_match: boolean | null;
}

describe("A dedicated parser's success ends parsing", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  const jobs: Record<string, StoredJob | null> = {};

  const ownPageVisits = () =>
    sites.visits.filter((visit) =>
      Object.values(JOBS).some((job) => new URL(job.link).host === visit.host && job.pagePath === visit.path)
    );

  beforeAll(async () => {
    await sites.start();
    dir = mkdtempSync(join(tmpdir(), "pipeline-general-dedicated-success-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);

    const saved = await saveJobs(
      Object.entries(JOBS).map(([name, job]) => ({
        id: job.id,
        original_url: job.link,
        resolved_url: job.link,
        // A title of its own, so duplicate matching never folds two together.
        raw_title: `Designer, ${name}`,
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
    if (saved.jobs.length !== Object.keys(JOBS).length) {
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

    for (const [name, job] of Object.entries(JOBS)) {
      jobs[name] = await db.job.findUnique({
        where: { id: job.id },
        select: {
          status: true,
          parser: true,
          description: true,
          is_classified: true,
          location_match: true,
        },
      });
    }
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("A dedicated parser's success ends parsing", () => {
    expect(jobs["lever"]?.parser).toBe("lever");
    expect(jobs["lever"]?.description ?? "").toContain(LEVER_DESCRIPTION);
    // The general parser opens a job's own page, and nothing else does here.
    expect(ownPageVisits()).toEqual([]);
  });

  test("Greenhouse keeps the employer links it recognises", () => {
    expect(jobs["employerSite"]?.parser).toBe("greenhouse");
    expect(jobs["employerSite"]?.description ?? "").toContain(GREENHOUSE_DESCRIPTION);
  });

  test("Dedicated-parser jobs keep today's location rule", () => {
    expect(jobs["remote"]?.parser).toBe("lever");
    expect(jobs["remote"]?.is_classified).toBe(true);
    expect(jobs["remote"]?.location_match).toBe(true);
    expect(jobs["remote"]?.status).toBe("backlog");
  });
});
