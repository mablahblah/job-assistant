// Flow test: Dead pages expire their jobs.
//
// Five jobs wait in the backlog on a website no dedicated parser claims, each
// already followed to its posting:
//
// - One page answers "not found" (404).
// - One answers "gone" (410) while still carrying search-engine job data.
// - One redirects to an address announcing an error.
// - One loads with no job data and no job text, in a plain request and in a
//   browser alike.
// - One is live, and its job data names an end date in 1970. Dover's job data
//   carried that placeholder when measured.
//
// A job search reads them, and the test checks what the parsing step recorded
// for each, which pages a browser opened, and the parsing lines of the summary.
//
// What the parsing step recorded is checked, not each job's status at the end
// of the search. Later in the same search, promotion returns a recently
// expired job to the backlog, whatever expired it. That gap is tracked as Dead
// Postings Stay Expired, and the user chose to check the parsing step here.
//
// Real services run against a scratch database. The website is a local
// stand-in server, and the browser is a real one, launched to find the
// website on this machine, so nothing here reaches a real website.
//
// Covers: A gone page expires the job, An error address expires the job, An
// empty page expires the job, A past end date does not expire a job, A
// dead-page expiry has its own reason, No browser for a gone page, A dead job
// counts as read.
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
import { summaryFromTraceCounts } from "../utils/run-summary";
import { runJobSearch } from "./job-search";
import { createLastSuccessService } from "../services/last-success-service";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, a job search runs after, and it
// launches a real browser. A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 240_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const RUN_ID = "run-dead-pages";

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Every reason the pipeline already records at parsing, and the one every
// age-based expiry carries. A dead page's reason must be none of these.
const EXISTING_REASONS = [
  "no_parser_for_domain",
  "parser_errored",
  "nothing_parsed",
  "past_expiration_threshold",
];

const HOST = "careers.dunmore.example";

const PATHS = {
  notFound: "/jobs/404",
  gone: "/jobs/410",
  errorAddress: "/jobs/moved",
  empty: "/jobs/empty",
  pastEndDate: "/jobs/live",
};
const DEAD = ["notFound", "gone", "errorAddress", "empty"] as const;
const ERROR_LANDING = "/careers?error=true";

function jobDataPage(extra: Record<string, unknown>): string {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Product Designer",
    datePosted: "2026-08-28",
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: "Austin", addressRegion: "TX" },
    },
    description: "<p>Design Dunmore's freight tracking tools.</p>",
    ...extra,
  };
  return (
    "<!DOCTYPE html><html><head><title>Dunmore Careers</title>" +
    `<script type="application/ld+json">${JSON.stringify(block)}</script>` +
    "</head><body><p>Design Dunmore's freight tracking tools.</p></body></html>"
  );
}

// The page an error redirect lands on: a live careers page with plenty of
// text, so only its address can say the posting is gone.
const CAREERS_OVERVIEW =
  "<!DOCTYPE html><html><head><title>Careers at Dunmore</title></head><body><main><article>" +
  "<h1>Careers at Dunmore</h1>" +
  "<p>Dunmore moves freight for thousands of small businesses across North America, and our " +
  "teams build the tools that keep every shipment visible from the loading dock to the door.</p>" +
  "<p>We hire designers, engineers and operators who care about the people on the other end of " +
  "every delivery. Browse our open roles to find a team that fits the way you like to work.</p>" +
  "<p>Every role comes with health cover, a learning budget, and time set aside each quarter " +
  "to work on whatever would make the product better for our customers.</p>" +
  "</article></main></body></html>";

// A page that loads but shows no job: a site's frame with nothing in it.
const EMPTY_PAGE =
  "<!DOCTYPE html><html><head><title>Dunmore</title></head><body>" +
  "<nav><a href='/'>Home</a> <a href='/careers'>Careers</a></nav><div id='root'></div></body></html>";

const pages: SitePages = {
  [`${HOST}${PATHS.notFound}`]: { status: 404, body: "<html><body>Not found</body></html>" },
  [`${HOST}${PATHS.gone}`]: { status: 410, body: jobDataPage({}) },
  [`${HOST}${ERROR_LANDING}`]: { body: CAREERS_OVERVIEW },
  [`${HOST}${PATHS.empty}`]: { body: EMPTY_PAGE },
  [`${HOST}${PATHS.pastEndDate}`]: { body: jobDataPage({ validThrough: "1970-01-01T00:00:00Z" }) },
};
const sites = fakePageFetcher(pages);

const linkTo = (path: string) => `http://${HOST}:${sites.port()}${path}`;
const idFor = (name: string) => `job-${name}`;

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

describe("Dead pages expire their jobs", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  // The reason on each job's parsing row, null where it carries none.
  const parsingReasons: Record<string, (string | null)[]> = {};
  let liveStatus: string | undefined;
  let summary: string[];

  const browserVisitsTo = (path: string) =>
    sites.visits.filter((visit) => visit.via === "browser" && visit.path === path);

  beforeAll(async () => {
    await sites.start();
    // The redirect names its landing address in full, port and all, so a
    // browser following it would reach this server too.
    pages[`${HOST}${PATHS.errorAddress}`] = { redirectTo: linkTo(ERROR_LANDING) };

    dir = mkdtempSync(join(tmpdir(), "pipeline-general-dead-pages-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);
    const { company } = await companies.create({ name: "Dunmore" });

    const saved = await saveJobs(
      Object.entries(PATHS).map(([name, path]) => ({
        id: idFor(name),
        original_url: linkTo(path),
        resolved_url: linkTo(path),
        // A title of its own, so duplicate matching never folds two together.
        raw_title: `Product Designer, ${name}`,
        raw_company_name: "Dunmore",
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
    if (saved.jobs.length !== Object.keys(PATHS).length) {
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

    for (const name of Object.keys(PATHS)) {
      const rows = await db.trace.findMany({
        where: { run_id: RUN_ID, job_id: idFor(name), step: "parsing" },
        select: { reason: true },
      });
      parsingReasons[name] = rows.map((row) => row.reason);
    }
    liveStatus = (
      await db.job.findUnique({ where: { id: idFor("pastEndDate") }, select: { status: true } })
    )?.status;
    summary = summaryFromTraceCounts(await trace.countsForRun(RUN_ID), [], null);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  // The reason a dead page's job was expired for. Every dead job must carry
  // the same one, so it is read off the first.
  const deadReason = () => parsingReasons["notFound"]?.[0] ?? null;

  const expectExpiredAsDead = (name: string) => {
    expect(deadReason(), "a dead page's reason").not.toBeNull();
    expect(EXISTING_REASONS, "a dead page's reason").not.toContain(deadReason());
    expect(parsingReasons[name], name).toEqual([deadReason()]);
  };

  test("A gone page expires the job", () => {
    expectExpiredAsDead("notFound");
    expectExpiredAsDead("gone");
  });

  test("An error address expires the job", () => {
    expectExpiredAsDead("errorAddress");
  });

  test("An empty page expires the job", () => {
    expectExpiredAsDead("empty");
    // Empty in a plain request, so a browser was tried before calling it dead.
    expect(browserVisitsTo(PATHS.empty).length).toBeGreaterThan(0);
  });

  test("A past end date does not expire a job", () => {
    expect(parsingReasons["pastEndDate"]).toEqual([null]);
    expect(liveStatus).toBe("backlog");
  });

  test("A dead-page expiry has its own reason", () => {
    expect(EXISTING_REASONS).not.toContain(deadReason());
    for (const name of DEAD) {
      expect(parsingReasons[name], name).toEqual([deadReason()]);
    }
  });

  test("No browser for a gone page", () => {
    expect(browserVisitsTo(PATHS.notFound)).toEqual([]);
    expect(browserVisitsTo(PATHS.gone)).toEqual([]);
    expect(browserVisitsTo(PATHS.errorAddress)).toEqual([]);
    expect(browserVisitsTo(ERROR_LANDING)).toEqual([]);
  });

  test("A dead job counts as read", () => {
    expect(summary).toContain("Parsed: 5 jobs");
    expect(summary.some((line) => line.includes("could not be parsed"))).toBe(false);
  });
});
