// Flow test: Two systems claim one board name.
//
// Board names share one namespace across every hiring system: the board table
// holds each name once, and company matching looks a name up without regard
// to which system it came from. So "acme" on Greenhouse and "acme" on Gem
// would land on one board row, and a company could be misfiled. No such clash
// was measured on 2026-09-24 — none of 53 board names from the new systems'
// stored jobs matched any of 128 saved boards — so nothing prevents one, and
// the user is warned instead.
//
// The board name "acme" is already recorded from a Greenhouse posting. One job
// search reads a Gem posting carrying the same name, and a second job search
// reads another Greenhouse posting carrying it. The test checks the warnings
// each job search prints and the board rows held for that name.
//
// Real services run against a scratch database. The one thing standing in is
// the two hiring systems: global fetch is swapped for a stand-in server
// answering each system's single-posting address, in the shape it returned
// when measured live. Nothing here reaches a real website.
//
// Covers: A board-name clash warning names the board, A board-name clash
// warning names both systems, A board name arriving again from its own system
// raises no warning, A shared board name is not split into two boards.
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
import { issueLines } from "../utils/print-issues";
import { runJobSearch, type RunJobSearchOptions } from "./job-search";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and two job searches run after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

const FIRST_RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const SECOND_RUN_AT = new Date("2026-09-02T10:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

// The board name both systems carry.
const BOARD = "acme";

const GEM_LINK = `https://jobs.gem.com/${BOARD}/4621632004?utm_source=adzuna&utm_medium=adzuna`;
const GREENHOUSE_LINK = `https://boards.greenhouse.io/${BOARD}/jobs/5550001`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Stands in for Gem and Greenhouse. Gem's posting carries no employer name
// (measured 2026-09-24); Greenhouse's carries one (measured 2026-09-12).
const standIn: typeof fetch = async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input));

  if (url.host === "api.gem.com" && url.pathname === `/job_board/v0/${BOARD}/job_posts/4621632004`) {
    return json({
      absolute_url: `https://jobs.gem.com/${BOARD}/4621632004`,
      content: "<p>Design Acme Robotics' fleet dashboard.</p>",
      content_plain: "Design Acme Robotics' fleet dashboard.",
      created_at: "2026-08-28T22:26:01.000Z",
      first_published_at: "2026-08-30T22:51:02.331Z",
      id: "4621632004",
      location: { name: "Denver, CO" },
      title: "Product Designer, Fleet",
      updated_at: "2026-08-31T16:08:06.647Z",
    });
  }

  if (url.host === "boards-api.greenhouse.io" && url.pathname === `/v1/boards/${BOARD}/jobs/5550001`) {
    return json({
      id: 5550001,
      title: "Product Designer, Checkout",
      first_published: "2026-08-30T00:00:00Z",
      updated_at: "2026-08-31T00:00:00Z",
      location: { name: "Remote" },
      content: "<p>Design Acme Payments' checkout.</p>",
      company_name: "Acme Payments",
    });
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

// Answers every place lookup, so no run reaches a mapping service.
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

describe("Two systems claim one board name", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let gemRunWarnings: string[];
  let greenhouseRunWarnings: string[];
  let rowsForBoard: number;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-board-name-clash-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);
    const priorityList = await settings.getSourcePriorityList();
    const identifyingQueryValues = await settings.getIdentifyingQueryValues();

    // The board name, already recorded from a Greenhouse posting.
    const { company } = await companies.create({ name: "Acme Payments" });
    await db.atsSlug.create({ data: { slug: BOARD, company_id: company.id, parser: "greenhouse" } });

    globalThis.fetch = standIn;

    const shared: Omit<RunJobSearchOptions, "collectors" | "collectedAt" | "runId"> = {
      settings,
      companies,
      atsSlugs: createAtsSlugService(db),
      jobService,
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      trace: createTraceService(db),
      log: () => {},
    };

    // A job waiting in the backlog, already followed to its posting, whose
    // link carries the board name. Each carries its id, the way collection
    // hands every job one before anything saves it.
    const waitingJob = async (id: string, link: string, title: string, employer: string, at: Date) => {
      const saved = await saveJobs(
        [
          {
            id,
            original_url: link,
            resolved_url: link,
            raw_title: title,
            raw_company_name: employer,
            collector: "adzuna",
            collected_at: at,
            status: "backlog",
            is_resolved: true,
            is_parsed: false,
            is_classified: false,
          },
        ],
        { jobService, priorityList, identifyingQueryValues }
      );
      if (saved.jobs.length !== 1) {
        throw new Error(`the waiting job did not save: ${JSON.stringify(saved.warnings)}`);
      }
    };

    // The first job search reads a Gem posting carrying the same board name.
    await waitingJob("job-gem", GEM_LINK, "Product Designer, Fleet", "Acme Robotics", FIRST_RUN_AT);
    const gemRun = await runJobSearch({
      ...shared,
      collectors: [],
      collectedAt: FIRST_RUN_AT,
      runId: "run-gem",
    });
    // Exactly what the job-search command prints under its warnings heading.
    gemRunWarnings = issueLines("Warnings", gemRun.warnings);

    // The second reads another Greenhouse posting carrying it.
    await waitingJob(
      "job-greenhouse",
      GREENHOUSE_LINK,
      "Product Designer, Checkout",
      "Acme Payments",
      SECOND_RUN_AT
    );
    const greenhouseRun = await runJobSearch({
      ...shared,
      collectors: [],
      collectedAt: SECOND_RUN_AT,
      runId: "run-greenhouse",
    });
    greenhouseRunWarnings = issueLines("Warnings", greenhouseRun.warnings);

    rowsForBoard = await db.atsSlug.count({ where: { slug: BOARD } });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  // The printed warning lines naming the shared board name.
  const naming = (lines: string[]) => lines.filter((line) => line.includes(BOARD));

  test("A board-name clash warning names the board", () => {
    expect(naming(gemRunWarnings)).toHaveLength(1);
  });

  test("A board-name clash warning names both systems", () => {
    const warning = (naming(gemRunWarnings)[0] ?? "").toLowerCase();
    expect(warning).toContain("gem");
    expect(warning).toContain("greenhouse");
  });

  test("A board name arriving again from its own system raises no warning", () => {
    expect(naming(greenhouseRunWarnings)).toEqual([]);
  });

  test("A shared board name is not split into two boards", () => {
    expect(rowsForBoard).toBe(1);
  });
});
