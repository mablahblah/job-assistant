// Flow test: An unclaimed website's job is read from its job data.
//
// Two jobs wait in the backlog on a website no dedicated parser claims, each
// already followed to its posting. Both pages publish search-engine job data
// (a schema.org JobPosting block), naming a remote job's allowed countries,
// a title, an employer and pay. A job search reads them, and the test checks
// what each job holds afterwards.
//
// The source ranking list is set the way a user would order it by hand: the
// first job's collector ranks below the general parser, so the page's details
// win, and the second job's collector ranks above it, so its own location
// stands.
//
// Real services run against a scratch database. The websites are a local
// stand-in server, so nothing here reaches a real website.
//
// Covers: Unclaimed links go to the general parser, No browser when a plain
// fetch finds job data, The posted date comes from the job data, The updated
// date comes from the job data, Location comes from the job data, Work mode
// comes from the job data, Description comes from the job data, A remote job's
// allowed countries are its location, The title is left alone, The employer
// is left alone, Pay is left alone, The ranked list settles disagreements,
// Website rules files are not read, A job with a location is marked read, A
// job with a location stays in the backlog, Each job leaves parsing once.
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
import type { RawSalary } from "../types/job-list-entry";
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

// Both jobs were collected the day they were posted, on an earlier run, and
// have waited unread since. A job saved with no posting date takes its
// collection date as one, and saving keeps the latest of all a job's dates as
// its updated date, so a later collection date would stand in front of the
// page's own.
const COLLECTED_AT = new Date("2026-08-28T00:00:00.000Z");
const RUN_ID = "run-job-data";

type PipelineDb = ReturnType<typeof createPipelineDb>;

const HOST = "careers.northwind.example";

// What the first job's collector found. Its title, employer and pay must
// survive the page's, and its location must not.
const COLLECTOR_TITLE = "Senior Product Designer";
const COLLECTOR_EMPLOYER = "Northwind Health";
const COLLECTOR_PAY: RawSalary = {
  salary_min: 120000,
  salary_max: 150000,
  salary_period: "year",
  salary_currency: "USD",
};
const COLLECTOR_PLACE = "Austin, TX";

// The second job's collector ranks above the general parser, so its place
// must survive the page's.
const OUTRANKING_PLACE = "Denver, CO";

const PAGE_DESCRIPTION = "Lead the design of Northwind's patient scheduling tools.";

// A page's search-engine job data, as a remote posting publishes it: its place
// only as the countries a remote worker may live in.
function jobDataPage(countries: string[], description: string): string {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Principal Designer, from the page",
    hiringOrganization: { "@type": "Organization", name: "Page Employer Inc" },
    baseSalary: {
      "@type": "MonetaryAmount",
      currency: "USD",
      value: { "@type": "QuantitativeValue", minValue: 250000, maxValue: 300000, unitText: "YEAR" },
    },
    datePosted: "2026-08-28",
    dateModified: "2026-08-30",
    jobLocationType: "TELECOMMUTE",
    applicantLocationRequirements: countries.map((name) => ({ "@type": "Country", name })),
    description: `<p>${description}</p>`,
  };
  return (
    "<!DOCTYPE html><html><head><title>Careers</title>" +
    `<script type="application/ld+json">${JSON.stringify(block)}</script>` +
    `</head><body><h1>Careers</h1><p>${description}</p></body></html>`
  );
}

const sites = fakePageFetcher({
  [`${HOST}/jobs/101`]: { body: jobDataPage(["United States", "Canada"], PAGE_DESCRIPTION) },
  [`${HOST}/jobs/102`]: { body: jobDataPage(["Mexico"], "Design the clinic check-in kiosk.") },
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
  status: string;
  is_parsed: boolean;
  raw_title: string | null;
  raw_company_name: string | null;
  raw_salary: unknown;
  raw_location_list: unknown;
  normalized_mode_list: unknown;
  posting_date: Date | null;
  posting_updated_date: Date | null;
  description: string | null;
}

describe("An unclaimed website's job is read from its job data", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let northwind: StoredJob | null;
  let outranked: StoredJob | null;
  let parsingRows: Record<string, number>;

  beforeAll(async () => {
    await sites.start();
    dir = mkdtempSync(join(tmpdir(), "pipeline-general-job-data-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);

    // The general parser sits between the two collectors, as a user who wants
    // one aggregator's copy beaten and the other's kept would order it.
    const seeded = await settings.getSourcePriorityList();
    const reordered = [
      ...seeded.filter((entry) => entry !== "collector:adzuna" && entry !== "parser:general"),
      "parser:general",
      "collector:adzuna",
    ];
    if (reordered.indexOf("collector:jsearch") > reordered.indexOf("parser:general")) {
      throw new Error("jsearch must rank above the general parser for this test to mean anything");
    }
    await db.setting.update({ where: { id: 1 }, data: { source_priority_list: reordered } });

    const { company } = await companies.create({ name: COLLECTOR_EMPLOYER });

    const saved = await saveJobs(
      [
        {
          id: "job-northwind",
          original_url: linkTo("/jobs/101"),
          resolved_url: linkTo("/jobs/101"),
          raw_title: COLLECTOR_TITLE,
          raw_company_name: COLLECTOR_EMPLOYER,
          company_id: company.id,
          raw_salary: COLLECTOR_PAY,
          raw_location_list: [COLLECTOR_PLACE],
          collector: "adzuna",
          collected_at: COLLECTED_AT,
          status: "backlog",
          is_resolved: true,
          is_parsed: false,
          is_classified: false,
        },
        {
          id: "job-outranked",
          original_url: linkTo("/jobs/102"),
          resolved_url: linkTo("/jobs/102"),
          raw_title: "Product Designer, Kiosks",
          raw_company_name: COLLECTOR_EMPLOYER,
          company_id: company.id,
          raw_location_list: [OUTRANKING_PLACE],
          collector: "jsearch",
          collected_at: COLLECTED_AT,
          status: "backlog",
          is_resolved: true,
          is_parsed: false,
          is_classified: false,
        },
      ],
      {
        jobService,
        priorityList: reordered,
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
      status: true,
      is_parsed: true,
      raw_title: true,
      raw_company_name: true,
      raw_salary: true,
      raw_location_list: true,
      normalized_mode_list: true,
      posting_date: true,
      posting_updated_date: true,
      description: true,
    } as const;
    northwind = await db.job.findUnique({ where: { id: "job-northwind" }, select });
    outranked = await db.job.findUnique({ where: { id: "job-outranked" }, select });
    parsingRows = {};
    for (const id of ["job-northwind", "job-outranked"]) {
      parsingRows[id] = await db.trace.count({ where: { run_id: RUN_ID, job_id: id, step: "parsing" } });
    }
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Unclaimed links go to the general parser", () => {
    expect(northwind?.description ?? "").toContain(PAGE_DESCRIPTION);
  });

  test("No browser when a plain fetch finds job data", () => {
    const browserVisits = sites.visits.filter(
      (visit) => visit.via === "browser" && visit.path.startsWith("/jobs/")
    );
    expect(browserVisits).toEqual([]);
  });

  test("The posted date comes from the job data", () => {
    expect(northwind?.posting_date?.toISOString()).toBe("2026-08-28T00:00:00.000Z");
  });

  test("The updated date comes from the job data", () => {
    expect(northwind?.posting_updated_date?.toISOString()).toBe("2026-08-30T00:00:00.000Z");
  });

  test("Location comes from the job data", () => {
    expect(northwind?.raw_location_list).toEqual(
      expect.arrayContaining(["United States", "Canada"])
    );
  });

  test("Work mode comes from the job data", () => {
    expect(northwind?.normalized_mode_list).toEqual(["remote"]);
  });

  test("Description comes from the job data", () => {
    expect(northwind?.description ?? "").toContain(PAGE_DESCRIPTION);
  });

  test("A remote job's allowed countries are its location", () => {
    expect(northwind?.raw_location_list).toEqual(
      expect.arrayContaining(["United States", "Canada"])
    );
    expect(northwind?.raw_location_list).not.toContain(COLLECTOR_PLACE);
  });

  test("The title is left alone", () => {
    expect(northwind?.raw_title).toBe(COLLECTOR_TITLE);
  });

  test("The employer is left alone", () => {
    expect(northwind?.raw_company_name).toBe(COLLECTOR_EMPLOYER);
  });

  test("Pay is left alone", () => {
    expect(northwind?.raw_salary).toEqual(COLLECTOR_PAY);
  });

  test("The ranked list settles disagreements", () => {
    // The page outranks the first job's collector and loses to the second's.
    expect(northwind?.raw_location_list).not.toContain(COLLECTOR_PLACE);
    expect(outranked?.raw_location_list).toEqual([OUTRANKING_PLACE]);
  });

  test("Website rules files are not read", () => {
    expect(sites.visits.filter((visit) => visit.path === "/robots.txt")).toEqual([]);
  });

  test("A job with a location is marked read", () => {
    expect(northwind?.is_parsed).toBe(true);
  });

  test("A job with a location stays in the backlog", () => {
    expect(northwind?.status).toBe("backlog");
  });

  test("Each job leaves parsing once", () => {
    expect(parsingRows).toEqual({ "job-northwind": 1, "job-outranked": 1 });
  });
});
