// Flow test: A Workday job is read, and its employer's board is polled.
//
// Walks the whole path a Workday employer takes into direct polling. Two jobs
// an aggregator found wait in the backlog, both on one Workday board, one of
// their links carrying a language segment. A job search reads both postings,
// scoring then rates the employer above the promotion bar, and a second job
// search polls the board that promotion put on the Workday collector's list.
//
// Real services run against a scratch database. The one thing standing in is
// Workday itself: global fetch is swapped for a stand-in server answering the
// posting and board addresses, so nothing here reaches a real website.
//
// Covers: A Workday posting fills the job's description, A Workday posting
// fills the job's location, A Workday link with a language segment is read,
// A Workday posting records its board, A language segment does not create a
// second board, A high-scoring Workday employer is promoted, A board recorded
// from a posting can be polled.
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
import { COLLECTORS } from "../collectors/registry";
import { saveJobs } from "../handlers/save";
import { runJobSearch, type RunJobSearchOptions } from "./job-search";
import { runScoringSave } from "./scoring";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and two job searches run after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

const FIRST_RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const SCORED_AT = new Date("2026-09-01T11:00:00.000Z");
const SECOND_RUN_AT = new Date("2026-09-02T10:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

// The board both postings sit on: company meredith, data centre wd5, site EXT.
const HOST = "meredith.wd5.myworkdayjobs.com";

// The same board seen through two links. The first carries a language
// segment, which 15 of 41 stored Workday links did when measured on
// 2026-09-21, and which Workday's data address rejects.
const DIRECTOR_PATH = "/job/New-York-NY/Director--Design--People-App_JR15366";
const DESIGNER_PATH = "/job/New-York-NY/Product-Designer--Recipes_JR15400";
const DIRECTOR_LINK = `https://${HOST}/en-US/EXT${DIRECTOR_PATH}?utm_source=adzuna`;
const DESIGNER_LINK = `https://${HOST}/EXT${DESIGNER_PATH}`;

// A posting the board lists on the second run, which the first run never saw.
const POLLED_PATH = "/job/New-York-NY/Senior-Product-Designer_JR20001";

// Where Workday serves a posting as data, and where it serves the board's job
// list. The site name is compared without regard to case, because Workday
// answers EXT, ext and Ext alike (measured 2026-09-21).
const POSTING_DATA_PREFIX = `/wday/cxs/meredith/ext/job/`;
const BOARD_LIST_PATH = `/wday/cxs/meredith/ext/jobs`;

// Each posting the stand-in serves, keyed by the path after /job/, lowercased.
// The shape is the one Workday's data address returned for the circle and
// target postings when measured on 2026-09-23.
const POSTINGS: Record<string, { title: string; description: string; location: string }> = {
  "new-york-ny/director--design--people-app_jr15366": {
    title: "Director, Design - People App",
    description: "<p>Lead the design of the People app across every platform.</p>",
    location: "New York, NY",
  },
  "new-york-ny/product-designer--recipes_jr15400": {
    title: "Product Designer, Recipes",
    description: "<p>Design how home cooks find and save recipes.</p>",
    location: "Brooklyn, NY",
  },
  "new-york-ny/senior-product-designer_jr20001": {
    title: "Senior Product Designer",
    description: "<p>Own the design of the subscriptions checkout.</p>",
    location: "New York, NY",
  },
};

interface SentRequest {
  url: string;
  method: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Stands in for Workday. Every request is recorded, so a test can check what
// the collector asked for. Anything it does not recognise answers 404, the way
// a real server answers an address it does not hold.
function workdayStandIn(requests: SentRequest[]): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url, method });

    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (parsed.host !== HOST) return json({ error: "not found" }, 404);

    if (path.startsWith(POSTING_DATA_PREFIX)) {
      const posting = POSTINGS[path.slice(POSTING_DATA_PREFIX.length)];
      if (!posting) return json({ error: "not found" }, 404);
      return json({
        jobPostingInfo: {
          title: posting.title,
          jobDescription: posting.description,
          location: posting.location,
          postedOn: "Posted 3 Days Ago",
          startDate: "2026-08-29",
          timeType: "Full time",
          jobReqId: "JR15366",
          country: { descriptor: "United States of America" },
        },
        hiringOrganization: { name: "Meredith", url: "" },
      });
    }

    if (path === BOARD_LIST_PATH && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { offset?: number };
      if ((body.offset ?? 0) > 0) return json({ total: 0, jobPostings: [] });
      return json({
        total: 1,
        jobPostings: [
          {
            title: "Senior Product Designer",
            externalPath: POLLED_PATH,
            locationsText: "New York, NY",
            postedOn: "Posted Today",
            bulletFields: ["JR20001"],
          },
        ],
      });
    }

    return json({ error: "not found" }, 404);
  };
}

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
      latitude: 40.7128,
      longitude: -74.006,
      place_type: "city",
      display_name: "New York, New York",
      outline: null,
    };
  },
});

interface StoredJob {
  description: string | null;
  raw_location_list: unknown;
  company_id: string | null;
}

describe("A Workday job is read, and its employer's board is polled", () => {
  const originalFetch = globalThis.fetch;
  const requests: SentRequest[] = [];
  let dir: string;
  let db: PipelineDb;

  let directorJob: StoredJob | null;
  let designerJob: StoredJob | null;
  let boardsAfterReading: { parser: string; collector: string | null }[];
  let boardsAfterPromotion: { parser: string; collector: string | null }[];
  let secondRunRequests: SentRequest[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-workday-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const atsSlugs = createAtsSlugService(db);
    const jobService = createJobService(db);
    const trace = createTraceService(db);
    const priorityList = await settings.getSourcePriorityList();
    const identifyingQueryValues = await settings.getIdentifyingQueryValues();

    // The employer an aggregator already attached both jobs to.
    const { company } = await companies.create({ name: "Meredith" });

    // Both jobs sit in the backlog, already followed to their Workday posting
    // and waiting to be read. Each carries its id, the way collection hands
    // every job one before anything saves it.
    const directorId = "job-director";
    const designerId = "job-designer";
    const saved = await saveJobs(
      [DIRECTOR_LINK, DESIGNER_LINK].map((link, index) => ({
        id: index === 0 ? directorId : designerId,
        original_url: link,
        resolved_url: link,
        raw_title: index === 0 ? "Director, Design" : "Product Designer",
        raw_company_name: "Meredith",
        company_id: company.id,
        collector: "adzuna",
        collected_at: FIRST_RUN_AT,
        status: "backlog",
        is_resolved: true,
        is_parsed: false,
        is_classified: false,
      })),
      { jobService, priorityList, identifyingQueryValues }
    );
    if (saved.jobs.length !== 2) {
      throw new Error(`the two waiting jobs did not save: ${JSON.stringify(saved.warnings)}`);
    }

    globalThis.fetch = workdayStandIn(requests);

    const shared: Omit<RunJobSearchOptions, "collectors" | "collectedAt" | "runId"> = {
      settings,
      companies,
      atsSlugs,
      jobService,
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      trace,
      log: () => {},
    };

    // The first run polls nothing. It only reads the two waiting postings.
    await runJobSearch({ ...shared, collectors: [], collectedAt: FIRST_RUN_AT, runId: "run-read" });

    const readJob = (id: string) =>
      db.job.findUnique({
        where: { id },
        select: { description: true, raw_location_list: true, company_id: true },
      });
    directorJob = await readJob(directorId);
    designerJob = await readJob(designerId);

    boardsAfterReading = await db.atsSlug.findMany({
      where: { company_id: company.id },
      select: { parser: true, collector: true },
    });

    // Scoring rates the employer well above the promotion bar in every
    // category, which is what promotion acts on.
    const top = { score: 5, rationale: "Strong public record.", guessed: false };
    await runScoringSave({
      jobScores: [],
      companyScores: [
        {
          id: company.id,
          scores: {
            employee_satisfaction: top,
            customer_satisfaction: top,
            work_life_balance: top,
            political_alignment: top,
          },
        },
      ],
      settings,
      companies,
      jobService,
      atsSlugs,
      trace,
      runId: "run-score",
      scoredAt: SCORED_AT,
    });

    boardsAfterPromotion = await db.atsSlug.findMany({
      where: { company_id: company.id },
      select: { parser: true, collector: true },
    });

    // The second run polls whatever the registry names as the Workday
    // collector. Before this feature there is none, and nothing is polled.
    const firstRunRequestCount = requests.length;
    await runJobSearch({
      ...shared,
      collectors: COLLECTORS.filter((collector) => collector.name === "workday"),
      collectedAt: SECOND_RUN_AT,
      runId: "run-poll",
    });
    secondRunRequests = requests.slice(firstRunRequestCount);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("A Workday posting fills the job's description", () => {
    expect(designerJob?.description ?? "").toContain("Design how home cooks find and save recipes.");
  });

  test("A Workday posting fills the job's location", () => {
    expect(JSON.stringify(designerJob?.raw_location_list ?? null)).toContain("Brooklyn, NY");
  });

  test("A Workday link with a language segment is read", () => {
    expect(directorJob?.description ?? "").toContain(
      "Lead the design of the People app across every platform."
    );
  });

  test("A Workday posting records its board", () => {
    expect(boardsAfterReading).toContainEqual({ parser: "workday", collector: null });
  });

  test("A language segment does not create a second board", () => {
    expect(boardsAfterReading).toHaveLength(1);
  });

  test("A high-scoring Workday employer is promoted", () => {
    expect(boardsAfterPromotion).toEqual([{ parser: "workday", collector: "workday" }]);
  });

  test("A board recorded from a posting can be polled", () => {
    // The board's job list, asked for at Workday's data address with the
    // language segment gone, the way the collector has to send it.
    const listRequests = secondRunRequests.filter(
      (request) => new URL(request.url).pathname.toLowerCase() === BOARD_LIST_PATH
    );
    expect(listRequests.length).toBeGreaterThan(0);
    for (const request of listRequests) {
      expect(request.method).toBe("POST");
      expect(new URL(request.url).host).toBe(HOST);
    }
  });
});
