// Flow test: An UltiPro job is read, and its employer's board is polled.
//
// Walks the whole path an UltiPro employer takes into direct polling. A job an
// aggregator found waits in the backlog on an UltiPro posting. A job search
// reads the posting, scoring then rates the employer above the promotion bar,
// and a second job search polls the board that promotion put on the UltiPro
// collector's list.
//
// Real services run against a scratch database. The one thing standing in is
// UltiPro itself: global fetch is swapped for a stand-in server answering the
// posting page and the board's job list, so nothing here reaches a real
// website.
//
// Covers: An UltiPro posting fills the job's description, An UltiPro posting
// fills the job's location, An UltiPro posting records its board, A
// high-scoring UltiPro employer is promoted.
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
import { createLastSuccessService } from "../services/last-success-service";

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

const HOST = "recruiting.ultipro.com";

// An UltiPro board is named by a company code and a board id together.
const COMPANY_CODE = "acm1000acme";
const BOARD_ID = "5b3c4d2e-7f10-4a2b-9c3d-4e5f6a7b8c9d";

const WAITING_JOB_ID = "0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0";
const POLLED_JOB_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

// The link exactly as an aggregator stores it: lower case, with the job's
// only identity in the query string beside tracking values. Measured on
// 2026-09-21, UltiPro has no link that carries the job in its path.
const WAITING_LINK =
  `https://${HOST}/${COMPANY_CODE}/jobboard/${BOARD_ID}/opportunitydetail` +
  `?opportunityid=${WAITING_JOB_ID}&utm_source=adzuna&utm_medium=adzuna`;

// Where UltiPro serves a posting page, and where it serves the board's job
// list. Compared in lower case, because stored links and UltiPro's own
// addresses spell the same path in different cases.
const POSTING_PAGE_PATH = `/${COMPANY_CODE}/jobboard/${BOARD_ID}/opportunitydetail`;
const BOARD_LIST_PATH = `/${COMPANY_CODE}/jobboard/${BOARD_ID}/jobboardview/loadsearchresults`;

interface UltiProOpportunity {
  Id: string;
  Title: string;
  Description: string;
  City: string;
  StateCode: string;
}

const OPPORTUNITIES: Record<string, UltiProOpportunity> = {
  [WAITING_JOB_ID]: {
    Id: WAITING_JOB_ID,
    Title: "Product Designer",
    Description: "<p>Design the claims experience for our members.</p>",
    City: "Austin",
    StateCode: "TX",
  },
  [POLLED_JOB_ID]: {
    Id: POLLED_JOB_ID,
    Title: "Senior Product Designer",
    Description: "<p>Lead design for the provider portal.</p>",
    City: "Denver",
    StateCode: "CO",
  },
};

function locationsOf(opportunity: UltiProOpportunity) {
  return [
    {
      LocalizedName: `${opportunity.City} Office`,
      Address: {
        City: opportunity.City,
        State: { Code: opportunity.StateCode, Name: opportunity.StateCode },
        Country: { Code: "USA", Name: "United States" },
      },
    },
  ];
}

// The posting page as UltiPro serves it to a plain request: the whole job sits
// in a script, handed to CandidateOpportunityDetail. Measured live on
// 2026-09-23 — there is no JSON-LD block on the page to read instead.
function postingPage(opportunity: UltiProOpportunity): string {
  const detail = {
    Id: opportunity.Id,
    Title: opportunity.Title,
    Featured: false,
    FullTime: true,
    JobCategoryName: "Design",
    Locations: locationsOf(opportunity),
    PostedDate: "2026-08-25T15:00:00.000Z",
    UpdatedDate: "2026-08-26T15:00:00.000Z",
    RequisitionNumber: "DESIG001234",
    Description: opportunity.Description,
    OpportunityIsClosed: false,
  };
  return [
    "<!DOCTYPE html><html><head><title>Opportunity Details</title></head><body>",
    "<script>",
    "    $(function () {",
    `        var opportunity = new US.Opportunity.CandidateOpportunityDetail(${JSON.stringify(detail)});`,
    "        var applicantSourceId = null;",
    "    });",
    "</script></body></html>",
  ].join("\n");
}

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

// Stands in for UltiPro. Every request is recorded, so a test can check what
// the collector asked for. Anything it does not recognise answers 404, the way
// a real server answers an address it does not hold.
function ultiproStandIn(requests: SentRequest[]): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url, method });

    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (parsed.host !== HOST) return json({ error: "not found" }, 404);

    if (path === POSTING_PAGE_PATH) {
      // The query key is matched in any case, the way the server matches it.
      const id = [...parsed.searchParams].find(([key]) => key.toLowerCase() === "opportunityid")?.[1];
      const opportunity = id ? OPPORTUNITIES[id.toLowerCase()] : undefined;
      if (!opportunity) return new Response("Not found", { status: 404 });
      return new Response(postingPage(opportunity), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (path === BOARD_LIST_PATH && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        opportunitySearch?: { Skip?: number };
      };
      if ((body.opportunitySearch?.Skip ?? 0) > 0) {
        return json({ opportunities: [], totalCount: 1 });
      }
      const polled = OPPORTUNITIES[POLLED_JOB_ID];
      return json({
        opportunities: [
          {
            Id: polled.Id,
            Title: polled.Title,
            FullTime: true,
            JobCategoryName: "Design",
            Locations: locationsOf(polled),
            PostedDate: "2026-09-01T15:00:00.000Z",
            BriefDescription: "Lead design for the provider portal.",
          },
        ],
        totalCount: 1,
      });
    }

    return json({ error: "not found" }, 404);
  };
}

// A browser that stays wherever it is sent. The stored job arrives already
// followed to its posting, so nothing here needs a real one; this only keeps
// the run whole if a job ever reaches resolution.
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

describe("An UltiPro job is read, and its employer's board is polled", () => {
  const originalFetch = globalThis.fetch;
  const requests: SentRequest[] = [];
  let dir: string;
  let db: PipelineDb;

  let waitingJob: { description: string | null; raw_location_list: unknown } | null;
  let boardsAfterReading: { parser: string; collector: string | null }[];
  let boardsAfterPromotion: { parser: string; collector: string | null }[];
  let secondRunRequests: SentRequest[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-ultipro-flow-"));
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

    // The employer an aggregator already attached the job to.
    const { company } = await companies.create({ name: "Acme Health" });

    // The job sits in the backlog, already followed to its UltiPro posting
    // and waiting to be read. It carries its id, the way collection hands
    // every job one before anything saves it.
    const waitingId = "job-waiting";
    const saved = await saveJobs(
      [
        {
          id: waitingId,
          original_url: WAITING_LINK,
          resolved_url: WAITING_LINK,
          raw_title: "Product Designer",
          raw_company_name: "Acme Health",
          company_id: company.id,
          collector: "adzuna",
          collected_at: FIRST_RUN_AT,
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

    globalThis.fetch = ultiproStandIn(requests);

    const shared: Omit<RunJobSearchOptions, "collectors" | "collectedAt" | "runId"> = {
      settings,
      companies,
      lastSuccesses: createLastSuccessService(db),
      atsSlugs,
      jobService,
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      trace,
      log: () => {},
    };

    // The first run polls nothing. It only reads the waiting posting.
    await runJobSearch({ ...shared, collectors: [], collectedAt: FIRST_RUN_AT, runId: "run-read" });

    waitingJob = await db.job.findUnique({
      where: { id: waitingId },
      select: { description: true, raw_location_list: true },
    });

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

    // The second run polls whatever the registry names as the UltiPro
    // collector. Before this feature there is none, and nothing is polled.
    const firstRunRequestCount = requests.length;
    await runJobSearch({
      ...shared,
      collectors: COLLECTORS.filter((collector) => collector.name === "ultipro"),
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

  test("An UltiPro posting fills the job's description", () => {
    expect(waitingJob?.description ?? "").toContain(
      "Design the claims experience for our members."
    );
  });

  test("An UltiPro posting fills the job's location", () => {
    expect(JSON.stringify(waitingJob?.raw_location_list ?? null)).toContain("Austin");
  });

  test("An UltiPro posting records its board", () => {
    expect(boardsAfterReading).toEqual([{ parser: "ultipro", collector: null }]);
  });

  test("A high-scoring UltiPro employer is promoted", () => {
    expect(boardsAfterPromotion).toEqual([{ parser: "ultipro", collector: "ultipro" }]);
  });

  test("the UltiPro collector then reads that board", () => {
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
