// Flow test: A stopped run.
//
// The home location setting is removed, so the run cannot judge any job's
// location. One link is added, and the test checks the lines the command
// prints name the step the run stopped at, why it stopped, and each step that
// finished before it.
//
// That the command then exits with a failure is the command's own, and is
// checked by the command's test.
//
// Real services run against a scratch database. The website and the browser
// that follows links are local stand-ins, so nothing here reaches a real
// website or a mapping service.
//
// Covers: A stopped run names its step, A stopped run gives its reason, A
// stopped run lists the finished steps.
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
import { addedJobsReport } from "../utils/added-jobs-report";
import { runAddExternalJobs, type RunAddExternalJobsResult } from "./add-external-jobs";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and the run follows. A ceiling
// rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const RUN_ID = "run-add-stopped";

type PipelineDb = ReturnType<typeof createPipelineDb>;

const ADDED = {
  hostAndPath: "careers.dunmore.example/jobs/101",
  title: "Product Designer",
  employer: "Dunmore",
};

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

describe("A stopped run", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let result: RunAddExternalJobsResult;
  let report: string[];

  beforeAll(async () => {
    await sites.start();

    dir = mkdtempSync(join(tmpdir(), "pipeline-add-stopped-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    await db.setting.update({ where: { id: 1 }, data: { location: null } });

    globalThis.fetch = sites.fetch;

    result = await runAddExternalJobs({
      submissions: [
        {
          link: linkTo(ADDED.hostAndPath),
          title: ADDED.title,
          employer: ADDED.employer,
          description: "Design the tools Dunmore's freight teams use every day.",
        },
      ],
      settings: createSettingsService(db),
      companies: createCompanyService(db),
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      openBrowser: fakeResolutionBrowser(followedPages),
      waitForLoad: async () => {},
      launchParsingBrowser: sites.launchBrowser,
      places: fakePlaceService(),
      geocoder: fakeGeocoder(),
      collectedAt: RUN_AT,
      runId: RUN_ID,
      trace: createTraceService(db),
      log: () => {},
    });
    report = addedJobsReport(result);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("A stopped run names its step", () => {
    const at = result.failure?.at;
    expect(at).toBeTruthy();
    expect(report.some((line) => line.includes(String(at)))).toBe(true);
  });

  test("A stopped run gives its reason", () => {
    const reason = result.failure?.reason;
    expect(reason).toContain("location");
    expect(report.some((line) => line.includes(String(reason)))).toBe(true);
  });

  test("A stopped run lists the finished steps", () => {
    // The location is first needed to judge where a job is, so the stretches
    // before that have finished by the time the run stops.
    expect(result.handlers.length).toBeGreaterThan(0);
    for (const handler of result.handlers) {
      expect(
        report.some((line) => line.includes(handler.step)),
        handler.step
      ).toBe(true);
    }
  });
});
