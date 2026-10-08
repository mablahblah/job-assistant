// Flow test: Adding only links to jobs I already settled.
//
// Three jobs are already saved, at won't apply, rejected and app. sent. One
// link is added for each, the same link the saved job holds, so no job is
// left needing its link followed.
//
// Following links opens a headed browser that holds the machine while it
// runs, so the test checks the browser that follows links is never opened.
//
// Real services run against a scratch database. The website and the browser
// that follows links are local stand-ins, and every place is answered by a
// stand-in, so nothing here reaches a real website or a mapping service.
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
import { fakeResolutionBrowser } from "../tools/resolution-browser.fake";
import { saveJobs } from "../handlers/save";
import type { JobListEntry } from "../types/job-list-entry";
import { runAddExternalJobs } from "./add-external-jobs";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and the run follows. A ceiling
// rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
// Inside the seeded 8-day expiry threshold, so no saved job is old.
const SAVED_AT = new Date("2026-08-29T10:00:00.000Z");
const RUN_ID = "run-add-settled-jobs";

type PipelineDb = ReturnType<typeof createPipelineDb>;

// The statuses the user gives a job, which an added link leaves alone.
const USER_STATUSES = ["won't apply", "rejected", "app. sent"];

const slugOf = (status: string) => status.replace(/[^a-z]+/g, "-");
const savedIdFor = (status: string) => `saved-${slugOf(status)}`;
const hostAndPathFor = (status: string) => `careers.dunmore.example/jobs/${slugOf(status)}`;

function postingPage(): string {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "A role",
    datePosted: "2026-08-29",
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: "Austin", addressRegion: "TX" },
    },
    description: "<p>The page's own description of this role.</p>",
  };
  return (
    "<!DOCTYPE html><html><head><title>Careers</title>" +
    `<script type="application/ld+json">${JSON.stringify(block)}</script>` +
    "</head><body><p>The page's own description of this role.</p></body></html>"
  );
}

const postingHostAndPaths = USER_STATUSES.map(hostAndPathFor);

// What a parser finds when it reads each posting.
const sites = fakePageFetcher(
  Object.fromEntries(postingHostAndPaths.map((hostAndPath) => [hostAndPath, { body: postingPage() }]))
);

const linkTo = (hostAndPath: string) => {
  const slash = hostAndPath.indexOf("/");
  return `http://${hostAndPath.slice(0, slash)}:${sites.port()}${hostAndPath.slice(slash)}`;
};

// What the browser that follows links would find, were it opened.
const followedPages: SitePages = Object.fromEntries(
  postingHostAndPaths.map((hostAndPath) => [hostAndPath, { body: "<p>A job posting</p>" }])
);

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

// Answers every place lookup with the user's own city, so the run never
// reaches a mapping service.
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

describe("Adding only links to jobs I already settled", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let browserOpens = 0;

  beforeAll(async () => {
    await sites.start();

    dir = mkdtempSync(join(tmpdir(), "pipeline-add-settled-jobs-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);
    const { company: dunmore } = await companies.create({ name: "Dunmore" });

    const savedJobs: JobListEntry[] = USER_STATUSES.map((status) => ({
      id: savedIdFor(status),
      collector: "adzuna",
      collected_at: SAVED_AT,
      is_resolved: true,
      is_parsed: true,
      is_classified: true,
      original_url: linkTo(hostAndPathFor(status)),
      resolved_url: linkTo(hostAndPathFor(status)),
      raw_title: `Product Designer, ${status}`,
      title: `Product Designer, ${status}`,
      raw_company_name: "Dunmore",
      company_id: dunmore.id,
      raw_location_list: ["Austin, TX"],
      status,
    }));
    const saved = await saveJobs(savedJobs, {
      jobService,
      priorityList: await settings.getSourcePriorityList(),
      identifyingQueryValues: await settings.getIdentifyingQueryValues(),
    });
    if (saved.jobs.length !== savedJobs.length) {
      throw new Error(`the saved jobs did not save: ${JSON.stringify(saved.warnings)}`);
    }

    globalThis.fetch = sites.fetch;

    const browser = fakeResolutionBrowser(followedPages);
    await runAddExternalJobs({
      submissions: USER_STATUSES.map((status) => ({
        link: linkTo(hostAndPathFor(status)),
        title: "Product Designer",
        employer: "Dunmore",
        description: "Design the tools Dunmore's freight teams use every day.",
      })),
      settings,
      companies,
      atsSlugs: createAtsSlugService(db),
      jobService,
      openBrowser: async () => {
        browserOpens += 1;
        return browser();
      },
      waitForLoad: async () => {},
      launchParsingBrowser: sites.launchBrowser,
      places,
      geocoder: fakeGeocoder(),
      collectedAt: RUN_AT,
      runId: RUN_ID,
      trace: createTraceService(db),
      log: () => {},
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the browser that follows links is never opened", () => {
    expect(browserOpens).toBe(0);
  });
});
