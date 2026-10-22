// Flow test: A bought Fantastic.jobs job's journey from search to backlog.
//
// On a machine set to US Central time, one job search runs, and the remote
// search returns eleven jobs:
//
// - Two ADP jobs whose links differ only in "reqId".
// - Two Clever jobs whose links differ only in "gh_jid".
// - A job whose posted time is not a date.
// - A job posted before it was first found.
// - An edited job, whose posted time is later than its first-found time.
// - A job labelled with the plain word "Remote".
// - A job labelled "Remote OK" listing only an office far from home, with its
//   country and the areas remote work is allowed from.
// - A job labelled "Remote Solely".
// - A job whose employer page refuses to be read.
//
// The ADP jobs sit on a hiring system no dedicated parser reads, and the far
// office's page names no location. The test checks the saved jobs, their trace
// rows and the run summary.
//
// Real services run against a scratch database. The one thing standing in is
// every website: global fetch is swapped for a stand-in answering Apify and
// each employer's page, so the real collector, the real Apify tool and the
// real parsers run, and nothing here reaches a paid service.
//
// Covers: Uses the service's link for both links, Skips link-following, Keeps
// jobs apart by the number after "?", Reads posted times as UTC, Keeps a job
// whose date cannot be read, Dates an unreadable-date job by first found, Keeps
// the first-found time, Reads a bought job's page with the general parser,
// Keeps the service's details when the page is refused, Reads "Remote OK" and
// "Remote Solely" as remote, Keeps the existing remote words, Gives remote
// jobs their country, Gives remote jobs their remote areas, Keeps an
// office-only remote job, Traces every job it bought, Lists its count in the
// summary.

// The machine runs on US Central time, so a time read as local rather than
// UTC lands five hours off and shows. Set before any date is read.
process.env["TZ"] = "America/Chicago";

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
import { createLastSuccessService } from "../services/last-success-service";
import { createSettingsService } from "../services/settings-service";
import { createTraceService } from "../services/trace-service";
import { fakePlaceService } from "../services/place-service.fake";
import { fakeGeocoder } from "../tools/geocoder.fake";
import type {
  ResolutionBrowserFactory,
  ResolutionPage,
  ResolutionResponse,
} from "../tools/resolution-page";
import { COLLECTORS } from "../collectors/registry";
import { summaryFromTraceCounts } from "../utils/run-summary";
import { runJobSearch } from "./job-search";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and a job search runs after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

const COLLECTOR = "fantastic-jobs";
const TOKEN = "apify_api_BoughtJobsFlowToken8Hc6";
const APIFY_HOST = "api.apify.com";
const RUN_ID = "run-bought-jobs";
// After every job's dates, and within the 8-day age limit of all of them.
const RUN_AT = new Date("2026-09-25T15:00:00.000Z");

// The Fantastic.jobs settings, by the column each is stored in. The columns
// are new with this feature, so they are written with plain SQL, the way
// ultipro-dedupe.flow.test.ts wrote a column before the client knew it.
const TOWNS = "search_towns";
const REMOTE_LABELS = "remote_labels";
const EXCLUDED_TITLES = "excluded_titles";
const WINDOW_DAYS = "search_window_days";

// The source ranking the real pipeline.db holds once the feature's migration
// has run, copied from it on 2026-10-22: every parser, the general parser
// among them, above every collector, and Fantastic.jobs directly after
// Workable, above the scraping and API collectors. A freshly seeded database
// ranks differently, with the general parser last and Adzuna and JSearch near
// the top, so it would not show how a real job search merges.
const LIVE_RANKING = [
  "collector:user",
  "parser:greenhouse",
  "parser:lever",
  "parser:ashby",
  "parser:workday",
  "parser:ultipro",
  "parser:dribbble",
  "parser:gem",
  "parser:smartrecruiters",
  "parser:bamboohr",
  "parser:rippling",
  "parser:workable",
  "parser:general",
  "collector:greenhouse",
  "collector:lever",
  "collector:ashby",
  "collector:workday",
  "collector:ultipro",
  "collector:gem",
  "collector:smartrecruiters",
  "collector:bamboohr",
  "collector:rippling",
  "collector:workable",
  "collector:fantastic-jobs",
  "collector:uiuxjobsboard",
  "collector:dribbble",
  "collector:adzuna",
  "collector:jsearch",
];

// One job as the service returns it, with only the fields this test reads
// set apart from the defaults below.
interface BoughtJob {
  title: string;
  organization: string;
  url: string;
  date_posted: string;
  date_created: string;
  locations_derived: string[];
  countries_derived: string[];
  ai_work_arrangement: string;
  ai_remote_location: string[] | null;
}

const IN_AUSTIN = {
  locations_derived: ["Austin, Texas, United States"],
  countries_derived: ["United States"],
  ai_work_arrangement: "On-site",
  ai_remote_location: null,
};

const DATED = { date_posted: "2026-09-21T14:00:00", date_created: "2026-09-21T14:30:00" };

const ADP_FIRST: BoughtJob = {
  ...IN_AUSTIN,
  ...DATED,
  title: "Product Designer",
  organization: "Nuclear Care Partners",
  url: "https://myjobs.adp.com/ncpjobs/cx/job-details?reqId=5001233496500",
};
const ADP_SECOND: BoughtJob = {
  ...ADP_FIRST,
  title: "Senior UX Designer",
  url: "https://myjobs.adp.com/ncpjobs/cx/job-details?reqId=5001233496501",
};
const CLEVER_FIRST: BoughtJob = {
  ...IN_AUSTIN,
  ...DATED,
  title: "Senior Product Designer",
  organization: "Clever",
  url: "https://www.clever.com/about/careers?gh_jid=8224363",
};
const CLEVER_SECOND: BoughtJob = {
  ...CLEVER_FIRST,
  title: "UX Designer, Platform",
  url: "https://www.clever.com/about/careers?gh_jid=8224364",
};
const UNREADABLE_DATE: BoughtJob = {
  ...IN_AUSTIN,
  title: "Product Designer, Growth",
  organization: "Tallpine",
  url: "https://careers.tallpine.example/roles/5",
  date_posted: "not a date",
  date_created: "2026-09-22T23:02:47",
};
const POSTED_FIRST: BoughtJob = {
  ...IN_AUSTIN,
  title: "Product Designer, Payments",
  organization: "Redcliff",
  url: "https://jobs.redcliff.example/openings/7",
  date_posted: "2026-09-23T20:11:41",
  date_created: "2026-09-24T01:00:00",
};
const EDITED: BoughtJob = {
  ...IN_AUSTIN,
  title: "UX Designer, Onboarding",
  organization: "Kestrel Labs",
  url: "https://kestrel.example/careers/301",
  date_posted: "2026-09-23T20:11:41",
  date_created: "2026-09-22T23:02:47",
};
const PLAIN_REMOTE: BoughtJob = {
  ...DATED,
  title: "Product Designer, Mobile",
  organization: "Ollieworks",
  url: "https://ollieworks.example/jobs/12",
  locations_derived: ["United States"],
  countries_derived: ["United States"],
  ai_work_arrangement: "Remote",
  ai_remote_location: ["United States"],
};
const FAR_OFFICE: BoughtJob = {
  ...DATED,
  title: "Senior Product Designer, Retirement",
  organization: "Inspira Financial",
  url: "https://careers.inspirafinancial.example/jobs/88",
  locations_derived: ["Oak Brook, Illinois, United States"],
  countries_derived: ["United States"],
  ai_work_arrangement: "Remote OK",
  ai_remote_location: ["Illinois, United States", "Wisconsin, United States"],
};
const REMOTE_SOLELY: BoughtJob = {
  ...DATED,
  title: "Product Designer, Messaging",
  organization: "ParentSquare",
  url: "https://parentsquare.example/careers/41",
  locations_derived: ["United States"],
  countries_derived: ["United States"],
  ai_work_arrangement: "Remote Solely",
  ai_remote_location: ["United States"],
};
const REFUSED_PAGE: BoughtJob = {
  ...IN_AUSTIN,
  title: "Product Designer, Search",
  organization: "Maslow Media Group",
  url: "https://maslowmedia.example/jobs/9",
  date_posted: "2026-09-20T14:00:00",
  date_created: "2026-09-20T15:00:00",
};

const BOUGHT = [
  ADP_FIRST,
  ADP_SECOND,
  CLEVER_FIRST,
  CLEVER_SECOND,
  UNREADABLE_DATE,
  POSTED_FIRST,
  EDITED,
  PLAIN_REMOTE,
  FAR_OFFICE,
  REMOTE_SOLELY,
  REFUSED_PAGE,
];

// A sentence only the ADP page's job data holds, so a description carrying it
// was read off that page.
const ADP_PAGE_DESCRIPTION = "Shape how Nuclear Care Partners' nurses plan their visits.";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// An employer's page publishing job data that names no place and no date, so
// the places and dates the service gave stand.
function employerPage(description: string): Response {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "A role",
    description: `<p>${description}</p>`,
  };
  return new Response(
    "<!DOCTYPE html><html><head><title>Careers</title>" +
      `<script type="application/ld+json">${JSON.stringify(block)}</script>` +
      `</head><body><p>${description}</p></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

// Stands in for every website. The remote search returns every bought job and
// the Austin search returns none. Each employer page answers with job data,
// apart from the one that refuses; anything else, including Greenhouse's
// address for recovering a board from a job number, is not found.
function standIn(): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));

    if (url.host === APIFY_HOST) {
      if (typeof init?.body !== "string") throw new Error("an Apify request carried no JSON body");
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const locations = Array.isArray(body["locationSearch"]) ? body["locationSearch"] : [];
      if (!locations.includes("United States")) return json([], 201);
      return json(
        BOUGHT.map((job, n) => ({
          id: String(2426526800 + n),
          ...job,
          source_type: "ats",
          description_text: "The service's own copy of the description.",
        })),
        201
      );
    }

    if (url.href === REFUSED_PAGE.url) {
      return new Response("<html><body>Access denied</body></html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.host === "myjobs.adp.com") return employerPage(ADP_PAGE_DESCRIPTION);
    if (BOUGHT.some((job) => job.url === url.href)) return employerPage("Design the product.");
    return json({ error: "not found" }, 404);
  };
}

// A browser that records every page it is sent to and stays there. A bought
// job is already at its posting, so it should never be sent here.
function recordingBrowser(visited: string[]): ResolutionBrowserFactory {
  return async () => ({
    openPage: async () => {
      let current = "about:blank";
      const page: ResolutionPage = {
        async goto(url: string): Promise<ResolutionResponse> {
          visited.push(url);
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

async function setSetting(db: PipelineDb, column: string, value: unknown): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE Setting SET ${column} = ? WHERE id = 1`,
    typeof value === "number" ? value : JSON.stringify(value)
  );
}

// The user's home, and a rough outline of the United States around it.
const HOME = { latitude: 30.2672, longitude: -97.7431 };
const UNITED_STATES_OUTLINE = {
  type: "Polygon",
  coordinates: [
    [
      [-125, 24],
      [-66, 24],
      [-66, 50],
      [-125, 50],
      [-125, 24],
    ],
  ],
};

// Answers every place lookup without a mapping service. The country holds
// home inside its outline; the far office and the two remote areas sit near
// Chicago, well past the search radius; everything else is home.
const places = fakePlaceService([], {
  async findByText(text: string) {
    if (/^(united states|usa|us)$/i.test(text.trim())) {
      return {
        lookup_text: text,
        latitude: 39.8,
        longitude: -98.6,
        place_type: "country",
        display_name: "United States",
        outline: UNITED_STATES_OUTLINE,
      };
    }
    if (/oak brook|illinois|wisconsin|\bIL\b|\bWI\b/i.test(text)) {
      return {
        lookup_text: text,
        latitude: 41.84,
        longitude: -87.95,
        place_type: "city",
        display_name: "Oak Brook, Illinois",
        outline: null,
      };
    }
    return {
      lookup_text: text,
      ...HOME,
      place_type: "city",
      display_name: "Austin, Texas",
      outline: null,
    };
  },
});

interface SavedJob {
  id: string;
  original_url: string | null;
  resolved_url: string | null;
  raw_title: string | null;
  raw_company_name: string | null;
  raw_location_list: unknown;
  normalized_mode_list: unknown;
  posting_date: Date | null;
  description: string | null;
  parser: string | null;
  status: string;
}

describe("A bought Fantastic.jobs job's journey from search to backlog", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env["FANTASTIC_JOBS_APIFY_TOKEN"];
  const visited: string[] = [];
  const saved: Record<string, SavedJob[]> = {};
  const collectedTraces: Record<string, number> = {};
  let collectedInRun = 0;
  let summary: string[] = [];
  let dir: string;
  let db: PipelineDb;

  // The one job saved under a bought link.
  const jobAt = (job: BoughtJob): SavedJob => {
    const rows = saved[job.url] ?? [];
    if (rows.length !== 1) throw new Error(`${rows.length} jobs saved at ${job.url}`);
    return rows[0] as SavedJob;
  };
  const placesOf = (job: BoughtJob) => {
    const list = jobAt(job).raw_location_list;
    return Array.isArray(list) ? list : [];
  };
  const modesOf = (job: BoughtJob) => {
    const list = jobAt(job).normalized_mode_list;
    return Array.isArray(list) ? list : [];
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-fantastic-jobs-bought-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    await db.setting.update({
      where: { id: 1 },
      data: {
        search_terms: ["Product Design", "UX"],
        expiry_threshold: 8,
        source_priority_list: LIVE_RANKING,
      },
    });
    await setSetting(db, TOWNS, ["Austin, Texas, United States"]);
    await setSetting(db, REMOTE_LABELS, ["Remote OK", "Remote Solely"]);
    await setSetting(db, EXCLUDED_TITLES, []);
    await setSetting(db, WINDOW_DAYS, 7);

    process.env["FANTASTIC_JOBS_APIFY_TOKEN"] = TOKEN;
    globalThis.fetch = standIn();

    const trace = createTraceService(db);
    const shared = {
      settings: createSettingsService(db),
      companies: createCompanyService(db),
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      lastSuccesses: createLastSuccessService(db),
      collectors: COLLECTORS.filter((collector) => collector.name === COLLECTOR),
      openBrowser: recordingBrowser(visited),
      waitForLoad: async () => {},
      // Every page here answers a plain request, so no parser needs a browser,
      // and none may open one on the real web.
      launchParsingBrowser: async () => {
        throw new Error("this test opens no parsing browser");
      },
      places,
      geocoder: fakeGeocoder(),
      trace,
      log: () => {},
    };
    await runJobSearch({ ...shared, collectedAt: RUN_AT, runId: RUN_ID });

    for (const job of BOUGHT) {
      saved[job.url] = await db.job.findMany({
        where: { resolved_url: job.url },
        select: {
          id: true,
          original_url: true,
          resolved_url: true,
          raw_title: true,
          raw_company_name: true,
          raw_location_list: true,
          normalized_mode_list: true,
          posting_date: true,
          description: true,
          parser: true,
          status: true,
        },
      });
      const [row] = saved[job.url] ?? [];
      collectedTraces[job.url] = row
        ? await db.trace.count({
            where: {
              run_id: RUN_ID,
              job_id: row.id,
              event: "job_collected",
              collector: COLLECTOR,
            },
          })
        : 0;
    }
    collectedInRun = await db.trace.count({
      where: { run_id: RUN_ID, event: "job_collected", collector: COLLECTOR },
    });

    const collectorNames = COLLECTORS.map((collector) => collector.name);
    summary = summaryFromTraceCounts(await trace.countsForRun(RUN_ID), collectorNames, null);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env["FANTASTIC_JOBS_APIFY_TOKEN"];
    else process.env["FANTASTIC_JOBS_APIFY_TOKEN"] = originalToken;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Uses the service's link for both links", () => {
    for (const job of BOUGHT) {
      expect(jobAt(job).original_url).toBe(job.url);
      expect(jobAt(job).resolved_url).toBe(job.url);
    }
  });

  test("Skips link-following", () => {
    expect(Object.values(saved).flat()).toHaveLength(BOUGHT.length);
    for (const job of BOUGHT) expect(visited).not.toContain(job.url);
  });

  test('Keeps jobs apart by the number after "?"', () => {
    for (const job of [ADP_FIRST, ADP_SECOND, CLEVER_FIRST, CLEVER_SECOND]) {
      expect(saved[job.url]).toHaveLength(1);
    }
    expect(jobAt(ADP_FIRST).id).not.toBe(jobAt(ADP_SECOND).id);
    expect(jobAt(CLEVER_FIRST).id).not.toBe(jobAt(CLEVER_SECOND).id);
  });

  test("Reads posted times as UTC", () => {
    expect(jobAt(POSTED_FIRST).posting_date?.toISOString()).toBe("2026-09-23T20:11:41.000Z");
  });

  test("Keeps a job whose date cannot be read", () => {
    expect(saved[UNREADABLE_DATE.url]).toHaveLength(1);
  });

  test("Dates an unreadable-date job by first found", () => {
    expect(jobAt(UNREADABLE_DATE).posting_date?.toISOString()).toBe("2026-09-22T23:02:47.000Z");
  });

  test("Keeps the first-found time", () => {
    expect(jobAt(EDITED).posting_date?.toISOString()).toBe("2026-09-22T23:02:47.000Z");
  });

  test("Reads a bought job's page with the general parser", () => {
    expect(jobAt(ADP_FIRST).parser).toBe("general");
    expect(jobAt(ADP_FIRST).description ?? "").toContain(ADP_PAGE_DESCRIPTION);
  });

  test("Keeps the service's details when the page is refused", () => {
    const job = jobAt(REFUSED_PAGE);
    expect(job.raw_title).toBe(REFUSED_PAGE.title);
    expect(job.raw_company_name).toBe(REFUSED_PAGE.organization);
    expect(placesOf(REFUSED_PAGE)).toEqual(expect.arrayContaining(REFUSED_PAGE.locations_derived));
    expect(job.posting_date?.toISOString()).toBe("2026-09-20T14:00:00.000Z");
    expect(job.status).toBe("backlog");
  });

  test('Reads "Remote OK" and "Remote Solely" as remote', () => {
    expect(modesOf(FAR_OFFICE)).toContain("remote");
    expect(modesOf(REMOTE_SOLELY)).toContain("remote");
  });

  test("Keeps the existing remote words", () => {
    expect(modesOf(PLAIN_REMOTE)).toContain("remote");
  });

  test("Gives remote jobs their country", () => {
    expect(placesOf(FAR_OFFICE)).toContain("United States");
  });

  test("Gives remote jobs their remote areas", () => {
    expect(placesOf(FAR_OFFICE)).toEqual(
      expect.arrayContaining(["Illinois, United States", "Wisconsin, United States"])
    );
  });

  test("Keeps an office-only remote job", () => {
    expect(placesOf(FAR_OFFICE)).toContain("Oak Brook, Illinois, United States");
    expect(jobAt(FAR_OFFICE).status).not.toBe("too far");
  });

  test("Traces every job it bought", () => {
    expect(collectedInRun).toBe(BOUGHT.length);
    for (const job of BOUGHT) expect(collectedTraces[job.url]).toBe(1);
  });

  test("Lists its count in the summary", () => {
    expect(summary).toContain(`  - ${COLLECTOR} collected ${BOUGHT.length} jobs`);
  });
});
