// Flow test: A job search polls an UltiPro board to its last job.
//
// One promoted UltiPro board holding 450 jobs, against a stand-in UltiPro
// server that hands back at most 200 jobs a reply, so the whole board takes
// three replies. Three jobs match the seeded search terms: one in each reply.
// One job search collects from the board, and the test reads back which jobs
// were collected.
//
// Measured 2026-09-21, UltiPro accepted a request for 200 jobs and returned a
// whole 49-job board. No larger request was measured, so the stand-in treats
// 200 as the most one reply holds.
//
// Real services run against a scratch database. The one thing standing in is
// UltiPro itself: global fetch is swapped for a stand-in server, so nothing
// here reaches a real website.
//
// Covers: Matching UltiPro jobs are collected, Non-matching UltiPro jobs are
// not collected, An UltiPro board is read to its last job.
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
import { runJobSearch } from "./job-search";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and a job search runs after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

const COLLECTED_AT = new Date("2026-09-01T10:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

const HOST = "recruiting.ultipro.com";

// An UltiPro board is named by a company code and a board id together.
const COMPANY_CODE = "acm1000acme";
const BOARD_ID = "5b3c4d2e-7f10-4a2b-9c3d-4e5f6a7b8c9d";
const BOARD_LIST_PATH = `/${COMPANY_CODE}/jobboard/${BOARD_ID}/jobboardview/loadsearchresults`;

const BOARD_SIZE = 450;
const MOST_ONE_REPLY_HOLDS = 200;

// The three jobs matching the seeded terms "Product Design", "UX" and
// "Founding Design", one in each reply. Every other job on the board is an
// accountant, which matches none of them.
const MATCHING: Record<number, string> = {
  3: "Product Designer",
  210: "Senior Product Designer",
  440: "UX Designer",
};

function opportunityId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

// The board's jobs in the shape UltiPro's job list returned them, measured
// live on 2026-09-23.
const BOARD = Array.from({ length: BOARD_SIZE }, (_, index) => ({
  Id: opportunityId(index),
  Title: MATCHING[index] ?? `Accountant ${index}`,
  FullTime: true,
  JobCategoryName: "Operations",
  Locations: [
    {
      LocalizedName: "Austin Office",
      Address: {
        City: "Austin",
        State: { Code: "TX", Name: "Texas" },
        Country: { Code: "USA", Name: "United States" },
      },
    },
  ],
  PostedDate: "2026-08-28T15:00:00.000Z",
  BriefDescription: "A role at Acme Health.",
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Stands in for UltiPro's board search: a POST to the board's job list, whose
// body asks for a number of jobs from a starting point. Anything else — a
// posting page included — answers 404, because reading postings is not what
// this test is about.
function ultiproStandIn(): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.host !== HOST || method !== "POST" || url.pathname.toLowerCase() !== BOARD_LIST_PATH) {
      return json({ error: "not found" }, 404);
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      opportunitySearch?: { Top?: number; Skip?: number };
    };
    const skip = body.opportunitySearch?.Skip ?? 0;
    const top = Math.min(body.opportunitySearch?.Top ?? 0, MOST_ONE_REPLY_HOLDS);
    return json({ opportunities: BOARD.slice(skip, skip + top), totalCount: BOARD_SIZE });
  };
}

// A browser that stays wherever it is sent. An UltiPro listing is already the
// posting, so nothing here needs a real one; this only keeps the run whole if
// a job ever reaches resolution.
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

describe("A job search polls an UltiPro board to its last job", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let collectedTitles: string[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-ultipro-paging-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const companies = createCompanyService(db);

    // The board is already promoted: its row names the UltiPro collector. Its
    // value is the company code and board id joined by a colon — the one text
    // value a board row holds.
    const { company } = await companies.create({ name: "Acme Health" });
    await db.atsSlug.create({
      data: {
        slug: `${COMPANY_CODE}:${BOARD_ID}`,
        company_id: company.id,
        parser: "ultipro",
        collector: "ultipro",
      },
    });

    globalThis.fetch = ultiproStandIn();

    await runJobSearch({
      settings: createSettingsService(db),
      companies,
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      collectors: COLLECTORS.filter((collector) => collector.name === "ultipro"),
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      collectedAt: COLLECTED_AT,
      runId: "run-ultipro-paging",
      trace: createTraceService(db),
      log: () => {},
    });

    const rows = await db.job.findMany({
      where: { collector: "ultipro" },
      select: { raw_title: true },
    });
    collectedTitles = rows.map((row) => row.raw_title ?? "");
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Matching UltiPro jobs are collected", () => {
    expect(collectedTitles).toEqual(expect.arrayContaining(["Product Designer"]));
  });

  test("Non-matching UltiPro jobs are not collected", () => {
    expect(collectedTitles.filter((title) => title.startsWith("Accountant"))).toEqual([]);
  });

  test("An UltiPro board is read to its last job", () => {
    // One matching job sits in each of the three replies, so all three are
    // collected only if the collector keeps asking until the board runs out.
    expect([...collectedTitles].sort()).toEqual(
      ["Product Designer", "Senior Product Designer", "UX Designer"].sort()
    );
  });
});
