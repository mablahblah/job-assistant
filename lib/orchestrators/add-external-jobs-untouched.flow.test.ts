// Flow test: Nothing else is touched.
//
// Three jobs from an earlier job search wait in the backlog: one waiting to be
// followed to its posting, one waiting to be read, and one waiting to be
// judged on its location. Each one's pages answer, so any step that reached
// it would change it.
//
// One unrelated link is added, and the test checks the waiting jobs are
// exactly as they were and that no step recorded collecting anything.
//
// Real services run against a scratch database. The website and the browser
// that follows links are local stand-ins, and every place is answered by a
// stand-in, so nothing here reaches a real website or a mapping service.
//
// Covers: No other waiting job is processed, No job source is asked.
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
import { saveJobs } from "../handlers/save";
import { runAddExternalJobs } from "./add-external-jobs";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and the run follows. A ceiling
// rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const SAVED_AT = new Date("2026-08-31T10:00:00.000Z");
const RUN_ID = "run-add-untouched";

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Each waiting job, and how far through the pipeline it has come.
const WAITING = [
  {
    id: "waiting-to-follow",
    hostAndPath: "careers.dunmore.example/jobs/1",
    is_resolved: false,
    is_parsed: false,
  },
  {
    id: "waiting-to-read",
    hostAndPath: "careers.dunmore.example/jobs/2",
    is_resolved: true,
    is_parsed: false,
  },
  {
    id: "waiting-to-judge",
    hostAndPath: "careers.dunmore.example/jobs/3",
    is_resolved: true,
    is_parsed: true,
  },
];
const waitingIds = WAITING.map((job) => job.id);

const ADDED = {
  hostAndPath: "jobs.tallpine.example/openings/7",
  title: "UX Researcher",
  employer: "Tallpine",
};

function postingPage(): string {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "A role",
    datePosted: "2026-08-31",
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

const hostAndPaths = [...WAITING.map((job) => job.hostAndPath), ADDED.hostAndPath];

// Every posting answers, for a parser and for the browser that follows links.
const sites = fakePageFetcher(
  Object.fromEntries(hostAndPaths.map((hostAndPath) => [hostAndPath, { body: postingPage() }]))
);
const followed = fakeResolutionBrowser(
  Object.fromEntries(hostAndPaths.map((hostAndPath) => [hostAndPath, { body: "<p>A job posting</p>" }]))
);

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

describe("Nothing else is touched", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let before: unknown[];
  let after: unknown[];
  let waitingSteps: string[];
  let collectionRows: number;

  const waitingRows = () =>
    db.job.findMany({ where: { id: { in: waitingIds } }, orderBy: { id: "asc" } });

  beforeAll(async () => {
    await sites.start();

    dir = mkdtempSync(join(tmpdir(), "pipeline-add-untouched-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);
    const { company } = await companies.create({ name: "Dunmore" });

    const saved = await saveJobs(
      WAITING.map((job) => ({
        id: job.id,
        original_url: linkTo(job.hostAndPath),
        resolved_url: job.is_resolved ? linkTo(job.hostAndPath) : null,
        // A title of its own, so duplicate matching never folds two together.
        raw_title: `Product Designer, ${job.id}`,
        title: `Product Designer, ${job.id}`,
        raw_company_name: "Dunmore",
        company_id: company.id,
        raw_location_list: ["Austin, TX"],
        normalized_location_list: job.is_parsed ? ["Austin, TX"] : null,
        collector: "adzuna",
        collected_at: SAVED_AT,
        status: "backlog",
        is_resolved: job.is_resolved,
        is_parsed: job.is_parsed,
        is_classified: false,
      })),
      {
        jobService,
        priorityList: await settings.getSourcePriorityList(),
        identifyingQueryValues: await settings.getIdentifyingQueryValues(),
      }
    );
    if (saved.jobs.length !== WAITING.length) {
      throw new Error(`the waiting jobs did not save: ${JSON.stringify(saved.warnings)}`);
    }
    before = await waitingRows();

    globalThis.fetch = sites.fetch;

    await runAddExternalJobs({
      submissions: [
        {
          link: linkTo(ADDED.hostAndPath),
          title: ADDED.title,
          employer: ADDED.employer,
          description: "Run the research behind Tallpine's booking app.",
        },
      ],
      settings,
      companies,
      atsSlugs: createAtsSlugService(db),
      jobService,
      openBrowser: followed,
      waitForLoad: async () => {},
      launchParsingBrowser: sites.launchBrowser,
      places,
      geocoder: fakeGeocoder(),
      collectedAt: RUN_AT,
      runId: RUN_ID,
      trace: createTraceService(db),
      log: () => {},
    });

    after = await waitingRows();
    const rows = await db.trace.findMany({
      where: { run_id: RUN_ID, job_id: { in: waitingIds } },
      select: { step: true },
    });
    waitingSteps = rows.map((row) => row.step);
    collectionRows = await db.trace.count({ where: { run_id: RUN_ID, step: "collection" } });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("No other waiting job is processed", () => {
    expect(before).toHaveLength(WAITING.length);
    expect(after).toEqual(before);
    expect(waitingSteps).toEqual([]);
    // The browser that follows links went only to the added job's link.
    expect(followed.visits).toEqual([ADDED.hostAndPath]);
  });

  test("No job source is asked", () => {
    expect(collectionRows).toBe(0);
  });
});
