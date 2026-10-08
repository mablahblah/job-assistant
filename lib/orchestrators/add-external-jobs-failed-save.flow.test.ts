// Flow test: Adding a list of links where one save fails.
//
// Three links to different postings near home are added in one go, and the
// save of one of them fails, so the other two have to be saved all the same.
//
// Real services run against a scratch database, except that the job service
// refuses every write of the failing link's job. The website and the browser
// that follows links are local stand-ins, and every place is answered by a
// stand-in, so nothing here reaches a real website or a mapping service.
//
// Covers: One failing link costs only itself.
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
import { runAddExternalJobs, type RunAddExternalJobsResult } from "./add-external-jobs";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and the run follows. A ceiling
// rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const RUN_ID = "run-add-list-save-fails";

type PipelineDb = ReturnType<typeof createPipelineDb>;

const NEAR_ONE = {
  hostAndPath: "careers.dunmore.example/jobs/101",
  title: "Product Designer",
  employer: "Dunmore",
  description: "Design the tools Dunmore's freight teams use every day.",
};
const NEAR_TWO = {
  hostAndPath: "jobs.tallpine.example/openings/7",
  title: "UX Researcher",
  employer: "Tallpine",
  description: "Run the research behind Tallpine's booking app.",
};
const NEAR_THREE = {
  hostAndPath: "careers.kestrel.example/jobs/55",
  title: "Interaction Designer",
  employer: "Kestrel",
  description: "Shape how Kestrel's customers track their orders.",
};

// Each posting's own page publishes job data naming a place near home.
function postingPage(): string {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "A role",
    datePosted: "2026-08-30",
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

const pages: SitePages = Object.fromEntries(
  [NEAR_ONE.hostAndPath, NEAR_TWO.hostAndPath, NEAR_THREE.hostAndPath].map((hostAndPath) => [
    hostAndPath,
    { body: postingPage() },
  ])
);
const sites = fakePageFetcher(pages);

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

// Answers every place lookup with the user's own city, so every posting here
// is near home and the run never reaches a mapping service.
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

describe("Adding a list of links where one save fails", () => {
  const originalFetch = globalThis.fetch;
  const failingLink = () => linkTo(NEAR_TWO.hostAndPath);
  let dir: string;
  let db: PipelineDb;
  let result: RunAddExternalJobsResult;

  beforeAll(async () => {
    await sites.start();

    dir = mkdtempSync(join(tmpdir(), "pipeline-add-list-save-fails-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    // The real job service, except that every write of the failing link's job
    // throws, the way a database refusing one row would.
    const realJobService = createJobService(db);
    const jobService: typeof realJobService = {
      ...realJobService,
      async update(entry, priorityList, identifyingQueryValues) {
        if (entry.original_url === failingLink()) throw new Error("the database refused the row");
        return realJobService.update(entry, priorityList, identifyingQueryValues);
      },
    };

    globalThis.fetch = sites.fetch;

    result = await runAddExternalJobs({
      submissions: [NEAR_ONE, NEAR_TWO, NEAR_THREE].map((posting) => ({
        link: linkTo(posting.hostAndPath),
        title: posting.title,
        employer: posting.employer,
        description: posting.description,
      })),
      settings: createSettingsService(db),
      companies: createCompanyService(db),
      atsSlugs: createAtsSlugService(db),
      jobService,
      openBrowser: fakeResolutionBrowser(pages),
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

  test("One failing link costs only itself", async () => {
    const failed = result.outcomes.find((outcome) => outcome.link === failingLink());
    expect(failed?.jobId).toBeNull();
    expect(await db.job.count({ where: { original_url: failingLink() } })).toBe(0);
    expect(
      result.warnings.some(
        (warning) => warning.message.includes("was not saved") && warning.message.includes(NEAR_TWO.title)
      )
    ).toBe(true);

    for (const posting of [NEAR_ONE, NEAR_THREE]) {
      const link = linkTo(posting.hostAndPath);
      const outcome = result.outcomes.find((candidate) => candidate.link === link);
      expect(outcome?.jobId, link).not.toBeNull();
      expect(await db.job.count({ where: { original_url: link } }), link).toBe(1);
    }
  });
});
