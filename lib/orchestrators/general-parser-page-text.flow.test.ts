// Flow test: A page with no job data is read from its text.
//
// Two jobs wait in the backlog on a website no dedicated parser claims, each
// already followed to its posting. Neither page publishes search-engine job
// data. Both show the job as ordinary page text:
//
// - The first labels a posted date, an updated date, a work mode and a place,
//   under a full description. Its collector supplied a different place, and
//   ranks below the general parser, so the parsed list of places is the one
//   saved.
// - The second labels a posted date and an updated date that cannot be read
//   as dates. Its collector supplied a real posted date.
//
// A job search reads them, and the test checks what each job holds afterwards
// and that no browser was needed.
//
// Real services run against a scratch database. The website is a local
// stand-in server, so nothing here reaches a real website.
//
// Covers: The posted date is read from page text, A labelled updated date is
// read from page text, Work mode is read from page text, The description is
// read from page text, A location from page text is added, A location from
// page text removes nothing, An unreadable posted date is not saved, An
// unreadable updated date is not saved, No browser when a plain fetch finds
// job text.
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
const RUN_ID = "run-page-text";

// The first job was collected the day it was posted, on an earlier run, and
// has waited unread since. A job saved with no posting date takes its
// collection date as one, and saving keeps the latest of all a job's dates as
// its updated date, so a later collection date would stand in front of the
// page's own.
const COLLECTED_AT = new Date("2026-08-28T00:00:00.000Z");

// The date the second job's collector published. The page's unreadable dates
// must leave it exactly as it was.
const COLLECTOR_POSTED = new Date("2026-08-27T00:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

const HOST = "jobs.quillsoft.example";

const COLLECTOR_PLACE = "Austin, TX";
const PAGE_PLACE = "Denver, CO";
const DESCRIPTION = "You will lead design for Quillsoft's contract review workspace.";

// A description long enough to read as a page's main article, the way a real
// posting's is.
const BODY_PARAGRAPHS = [
  DESCRIPTION,
  "Our legal teams spend hours comparing clauses across hundreds of agreements. You will work " +
    "with them to understand where that time goes, and shape the tools that give it back.",
  "You will partner with product and engineering from the first sketch to the shipped feature, " +
    "run research with in-house counsel, and set the patterns the rest of the design team follows.",
  "We are looking for someone with seven or more years of product design experience, a portfolio " +
    "showing complex workflow tools, and comfort presenting work to senior stakeholders.",
];

function textPage(labels: string[]): string {
  return (
    "<!DOCTYPE html><html><head><title>Senior Product Designer | Quillsoft</title></head><body>" +
    "<header><nav><a href='/'>Home</a> <a href='/jobs'>Jobs</a></nav></header>" +
    "<main><article><h1>Senior Product Designer</h1>" +
    labels.map((label) => `<p>${label}</p>`).join("") +
    BODY_PARAGRAPHS.map((paragraph) => `<p>${paragraph}</p>`).join("") +
    "</article></main><footer><p>Quillsoft, Inc.</p></footer></body></html>"
  );
}

const sites = fakePageFetcher({
  [`${HOST}/openings/31`]: {
    body: textPage([
      "Posted: Aug 28, 2026",
      "Updated: Aug 30, 2026",
      "This is a hybrid role, with two days a week in our Denver office.",
      `Location: ${PAGE_PLACE}`,
    ]),
  },
  [`${HOST}/openings/32`]: {
    body: textPage(["Posted: Coming soon", "Updated: TBD", `Location: ${COLLECTOR_PLACE}`]),
  },
});

const linkTo = (path: string) => `http://${HOST}:${sites.port()}${path}`;

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

interface StoredJob {
  is_parsed: boolean;
  raw_location_list: unknown;
  normalized_mode_list: unknown;
  posting_date: Date | null;
  posting_updated_date: Date | null;
  description: string | null;
}

describe("A page with no job data is read from its text", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let labelled: StoredJob | null;
  let unreadable: StoredJob | null;

  beforeAll(async () => {
    await sites.start();
    dir = mkdtempSync(join(tmpdir(), "pipeline-general-page-text-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);

    // Parsing adds the page's place to the collector's, and the saved list is
    // then settled by the ranking like any other. The general parser is
    // ranked above the collector here, so the added place is what gets saved.
    const seeded = await settings.getSourcePriorityList();
    const reordered = [
      ...seeded.filter((entry) => entry !== "collector:adzuna" && entry !== "parser:general"),
      "parser:general",
      "collector:adzuna",
    ];
    await db.setting.update({ where: { id: 1 }, data: { source_priority_list: reordered } });

    const { company } = await companies.create({ name: "Quillsoft" });

    const saved = await saveJobs(
      [
        {
          id: "job-labelled",
          original_url: linkTo("/openings/31"),
          resolved_url: linkTo("/openings/31"),
          raw_title: "Senior Product Designer",
          raw_company_name: "Quillsoft",
          company_id: company.id,
          raw_location_list: [COLLECTOR_PLACE],
          collector: "adzuna",
          collected_at: COLLECTED_AT,
          status: "backlog",
          is_resolved: true,
          is_parsed: false,
          is_classified: false,
        },
        {
          id: "job-unreadable-dates",
          original_url: linkTo("/openings/32"),
          resolved_url: linkTo("/openings/32"),
          raw_title: "Product Designer, Contracts",
          raw_company_name: "Quillsoft",
          company_id: company.id,
          raw_location_list: [COLLECTOR_PLACE],
          posting_date: COLLECTOR_POSTED,
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
    if (saved.jobs.length !== 2) {
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

    const select = {
      is_parsed: true,
      raw_location_list: true,
      normalized_mode_list: true,
      posting_date: true,
      posting_updated_date: true,
      description: true,
    } as const;
    labelled = await db.job.findUnique({ where: { id: "job-labelled" }, select });
    unreadable = await db.job.findUnique({ where: { id: "job-unreadable-dates" }, select });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("The posted date is read from page text", () => {
    expect(labelled?.posting_date?.toISOString()).toBe("2026-08-28T00:00:00.000Z");
  });

  test("A labelled updated date is read from page text", () => {
    expect(labelled?.posting_updated_date?.toISOString()).toBe("2026-08-30T00:00:00.000Z");
  });

  test("Work mode is read from page text", () => {
    expect(labelled?.normalized_mode_list).toEqual(["hybrid"]);
  });

  test("The description is read from page text", () => {
    expect(labelled?.description ?? "").toContain(DESCRIPTION);
  });

  test("A location from page text is added", () => {
    expect(labelled?.raw_location_list).toContain(PAGE_PLACE);
  });

  test("A location from page text removes nothing", () => {
    expect(labelled?.raw_location_list).toContain(COLLECTOR_PLACE);
  });

  test("An unreadable posted date is not saved", () => {
    // The page was read, so its dates were in front of the parser.
    expect(unreadable?.is_parsed).toBe(true);
    expect(unreadable?.posting_date?.toISOString()).toBe(COLLECTOR_POSTED.toISOString());
  });

  test("An unreadable updated date is not saved", () => {
    expect(unreadable?.is_parsed).toBe(true);
    expect(unreadable?.posting_updated_date ?? null).toBeNull();
  });

  test("No browser when a plain fetch finds job text", () => {
    expect(labelled?.description ?? "").toContain(DESCRIPTION);
    expect(sites.visits.filter((visit) => visit.via === "browser")).toEqual([]);
  });
});
