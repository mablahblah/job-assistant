// Flow test: A closed posting stays where it was.
//
// One job per system waits in the backlog, already followed to a posting that
// has since closed. Workable appears three times: once with a company-site
// link whose posting is gone, once with the link Workable redirects a closed
// posting to, which ends in `?not_found=true` and carries no job identifier,
// and once on its job search site, whose closed jobs answer 410 Gone. Two such
// Workable links and one such search-site job were stored on 2026-09-24. A
// job search reads them all, and the test checks each job's status afterwards.
//
// A closed posting says nothing about whether the system can be read, so it
// must not be set aside as unreadable. The General Purpose Parser Safety Net
// superseded this test's criterion on 2026-09-25: the dedicated parser's
// failure hands the job to the general parser, whose read of the closed page
// expires it for a dead page. The test reads what parsing recorded rather
// than the final status, because promotion still returns a recently expired
// job to the backlog later in the same search (Dead Postings Stay Expired).
//
// Real services run against a scratch database. The one thing standing in is
// the five hiring systems: global fetch is swapped for a stand-in server that
// answers every posting address the way a closed posting answers, so nothing
// here reaches a real website.
//
// Covers: A closed posting keeps its status.
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

// Creating and seeding each spawn npx tsx, and a job search runs after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

const TRACKING = "utm_source=adzuna&utm_medium=adzuna";

// Each waiting job, named for the case it stands for, with its stored link.
const CLOSED_JOBS: { name: string; link: string }[] = [
  { name: "workable company site", link: "https://apply.workable.com/northwind/j/3C1D2E4F5A/" },
  { name: "workable not-found link", link: "https://apply.workable.com/northwind/?not_found=true" },
  {
    name: "workable job search site",
    link: "https://jobs.workable.com/view/tyaZq6jybgHCVRBowKxp43/senior-product-designer-at-northwind-labs",
  },
  { name: "gem", link: `https://jobs.gem.com/brightline/4621632004?${TRACKING}` },
  {
    name: "smartrecruiters",
    link: "https://jobs.smartrecruiters.com/Harborview/744000147869999-senior-product-designer",
  },
  { name: "bamboohr", link: `https://quillsoft.bamboohr.com/careers/40?${TRACKING}` },
  {
    name: "rippling",
    link: `https://ats.rippling.com/lumenworks/jobs/371ee603-a211-467c-b868-b5f5b68ccbff?${TRACKING}`,
  },
];

const idFor = (name: string) => `job-${name.replace(/[^a-z]+/g, "-")}`;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Stands in for every hiring system at once, answering the way a closed
// posting answers. Workable's job search site answers 410 Gone, as the closed
// search-site job did when measured on 2026-09-24. Every other address answers
// 404, the way a board answers for a posting it no longer holds.
const everyPostingClosed: typeof fetch = async (input: string | URL | Request) => {
  const address = input instanceof Request ? input.url : String(input);
  if (new URL(address).host === "jobs.workable.com") {
    return json({ error: "gone" }, 410);
  }
  return json({ error: "not found" }, 404);
};

// A browser that stays wherever it is sent. The stored jobs arrive already
// followed to their posting, so nothing here needs a real one; this only
// keeps the run whole if a job ever reaches resolution.
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

// Answers every place lookup, so the run never reaches a mapping service.
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

describe("A closed posting stays where it was", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  const parsingRows: Record<string, { event: string; reason: string | null }[]> = {};

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-closed-posting-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);

    const { company } = await companies.create({ name: "Any Employer" });

    // Every job sits in the backlog, already followed to its posting and
    // waiting to be read.
    const saved = await saveJobs(
      CLOSED_JOBS.map((job) => ({
        id: idFor(job.name),
        original_url: job.link,
        resolved_url: job.link,
        // A title of its own, so duplicate matching, which treats one
        // employer's same title as one job, never folds two cases together.
        raw_title: `Product Designer, ${job.name}`,
        raw_company_name: "Any Employer",
        company_id: company.id,
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
    if (saved.jobs.length !== CLOSED_JOBS.length) {
      throw new Error(`the waiting jobs did not save: ${JSON.stringify(saved.warnings)}`);
    }

    globalThis.fetch = everyPostingClosed;

    await runJobSearch({
      settings,
      companies,
      atsSlugs: createAtsSlugService(db),
      jobService,
      collectors: [],
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      collectedAt: RUN_AT,
      runId: "run-closed",
      trace: createTraceService(db),
      log: () => {},
    });

    for (const job of CLOSED_JOBS) {
      parsingRows[job.name] = await db.trace.findMany({
        where: { run_id: "run-closed", job_id: idFor(job.name), step: "parsing" },
        select: { event: true, reason: true },
      });
    }
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  describe.each(CLOSED_JOBS)("$name", (job) => {
    test("A closed posting keeps its status", () => {
      expect(parsingRows[job.name]).toEqual([{ event: "job_parsed", reason: "dead_page" }]);
    });
  });
});
