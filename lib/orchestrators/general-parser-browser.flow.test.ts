// Flow test: A page built by its scripts is read in a browser.
//
// One job waits in the backlog on a website no dedicated parser claims,
// already followed to its posting. Its page is an empty shell to a plain
// request. In a browser, its script adds search-engine job data a moment
// after loading, and keeps asking the server for more content for as long as
// the page is open, as Dover's pages were measured doing. A job search reads
// it, and the test checks the job holds the job data's details.
//
// Real services run against a scratch database. The website is a local
// stand-in server, and the browser is a real one, launched to find the
// website on this machine, so nothing here reaches a real website.
//
// Covers: A browser opens only after a plain fetch finds nothing, A page that
// never stops loading is still read.
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

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, a job search runs after, and it
// launches a real browser. A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 240_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const RUN_ID = "run-browser";

// Collected the day it was posted, on an earlier run, and waiting unread
// since, so the collection date cannot stand in front of the page's dates.
const COLLECTED_AT = new Date("2026-08-28T00:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

const HOST = "apply.lumenworks.example";
const JOB_PATH = "/apply/lumenworks/8c1d2e3f";
const DESCRIPTION = "Design the scheduling assistant Lumenworks' clinics rely on.";

const JOB_DATA = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Product Designer",
  datePosted: "2026-08-28",
  jobLocationType: "TELECOMMUTE",
  applicantLocationRequirements: [{ "@type": "Country", name: "United States" }],
  description: `<p>${DESCRIPTION}</p>`,
};

// An empty shell until its script runs, as a plain request sees it: the job
// data is fetched by the script from an address of its own, so none of it is
// in the page's markup. A moment after loading, the script writes the job data
// into the page, and from then on keeps the network busy: one request the
// server never answers, and a fresh one every fifth of a second.
const SCRIPT_BUILT_PAGE =
  "<!DOCTYPE html><html><head><title>Lumenworks</title></head><body><div id='app'></div>" +
  "<script>" +
  "fetch('/api/posting').then(function (answer) { return answer.json(); }).then(function (data) {" +
  "  setTimeout(function () {" +
  "    var block = document.createElement('script');" +
  "    block.type = 'application/ld+json';" +
  "    block.textContent = JSON.stringify(data);" +
  "    document.head.appendChild(block);" +
  "    document.getElementById('app').innerHTML = data.description;" +
  "  }, 300);" +
  "});" +
  "fetch('/stream').catch(function () {});" +
  "setInterval(function () { fetch('/poll?at=' + Date.now()).catch(function () {}); }, 200);" +
  "</script></body></html>";

const sites = fakePageFetcher({
  [`${HOST}${JOB_PATH}`]: { body: SCRIPT_BUILT_PAGE },
  [`${HOST}/api/posting`]: { contentType: "application/json", body: JSON.stringify(JOB_DATA) },
  [`${HOST}/stream`]: { hang: true },
});

const linkTo = (path: string) => `http://${HOST}:${sites.port()}${path}`;

// A browser that stays wherever it is sent. The stored job arrives already
// followed to its posting, so link-following never needs a real one.
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
  raw_location_list: unknown;
  posting_date: Date | null;
  description: string | null;
}

describe("A page built by its scripts is read in a browser", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let job: StoredJob | null;

  beforeAll(async () => {
    await sites.start();
    dir = mkdtempSync(join(tmpdir(), "pipeline-general-browser-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);
    const { company } = await companies.create({ name: "Lumenworks" });

    const saved = await saveJobs(
      [
        {
          id: "job-script-built",
          original_url: linkTo(JOB_PATH),
          resolved_url: linkTo(JOB_PATH),
          raw_title: "Product Designer",
          raw_company_name: "Lumenworks",
          company_id: company.id,
          collector: "adzuna",
          collected_at: COLLECTED_AT,
          status: "backlog",
          is_resolved: true,
          is_parsed: false,
          is_classified: false,
        },
      ],
      {
        jobService,
        priorityList: await settings.getSourcePriorityList(),
        identifyingQueryValues: await settings.getIdentifyingQueryValues(),
      }
    );
    if (saved.jobs.length !== 1) {
      throw new Error(`the waiting job did not save: ${JSON.stringify(saved.warnings)}`);
    }

    globalThis.fetch = sites.fetch;

    await runJobSearch({
      settings,
      companies,
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

    job = await db.job.findUnique({
      where: { id: "job-script-built" },
      select: { raw_location_list: true, posting_date: true, description: true },
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("A browser opens only after a plain fetch finds nothing", () => {
    const visitsToJob = sites.visits.filter((visit) => visit.path === JOB_PATH);
    expect(visitsToJob.map((visit) => visit.via)).toEqual(["fetch", "browser"]);
    expect(job?.description ?? "").toContain(DESCRIPTION);
  });

  test("A page that never stops loading is still read", () => {
    expect(job?.description ?? "").toContain(DESCRIPTION);
    expect(job?.posting_date?.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(job?.raw_location_list).toEqual(["United States"]);
  });
});
