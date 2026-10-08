// Flow test: The protection ends with the run.
//
// One link is added whose posting gives no posting date, so its age runs from
// the day it was added. It lands in the backlog. A job search then runs,
// asking no job source, measured from a moment past the expiry threshold, and
// the test checks the added job is expired like any other.
//
// Real services run against a scratch database. The website and the browser
// that follows links are local stand-ins, and every place is answered by a
// stand-in, so nothing here reaches a real website or a mapping service.
//
// Covers: The protection ends with the run.
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
import { fakeResolutionBrowser } from "../tools/resolution-browser.fake";
import { runAddExternalJobs } from "./add-external-jobs";
import { runJobSearch } from "./job-search";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and two runs follow. A ceiling
// rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const ADDED_AT = new Date("2026-09-01T10:00:00.000Z");
// Nine days on, past the seeded 8-day expiry threshold.
const SEARCHED_AT = new Date("2026-09-10T10:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

const ADDED = {
  hostAndPath: "careers.dunmore.example/jobs/101",
  title: "Product Designer",
  employer: "Dunmore",
};

// Job data naming a place near home and no posting date at all.
function postingPage(): string {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "A role",
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

const sites = fakePageFetcher({ [ADDED.hostAndPath]: { body: postingPage() } });
const followedPages = { [ADDED.hostAndPath]: { body: "<p>A job posting</p>" } };

const linkTo = (hostAndPath: string) => {
  const slash = hostAndPath.indexOf("/");
  return `http://${hostAndPath.slice(0, slash)}:${sites.port()}${hostAndPath.slice(slash)}`;
};

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

describe("The protection ends with the run", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let statusAfterAdding: string | undefined;
  let statusAfterSearch: string | undefined;

  beforeAll(async () => {
    await sites.start();

    dir = mkdtempSync(join(tmpdir(), "pipeline-add-protection-ends-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    globalThis.fetch = sites.fetch;

    const shared = {
      settings: createSettingsService(db),
      companies: createCompanyService(db),
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      openBrowser: fakeResolutionBrowser(followedPages),
      waitForLoad: async () => {},
      launchParsingBrowser: sites.launchBrowser,
      places,
      geocoder: fakeGeocoder(),
      trace: createTraceService(db),
      log: () => {},
    };

    const added = await runAddExternalJobs({
      ...shared,
      submissions: [
        {
          link: linkTo(ADDED.hostAndPath),
          title: ADDED.title,
          employer: ADDED.employer,
          description: "Design the tools Dunmore's freight teams use every day.",
        },
      ],
      collectedAt: ADDED_AT,
      runId: "run-add-protection",
    });
    const jobId = added.outcomes[0]?.jobId;
    if (!jobId) throw new Error("the link was not added");
    const statusOf = async () =>
      (await db.job.findUnique({ where: { id: jobId }, select: { status: true } }))?.status;
    statusAfterAdding = await statusOf();

    await runJobSearch({
      ...shared,
      collectors: [],
      collectedAt: SEARCHED_AT,
      runId: "run-later-search",
    });
    statusAfterSearch = await statusOf();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("The protection ends with the run", () => {
    expect(statusAfterAdding).toBe("backlog");
    expect(statusAfterSearch).toBe("expired");
  });
});
