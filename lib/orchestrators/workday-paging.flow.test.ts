// Flow test: A job search polls a Workday board page by page.
//
// Two promoted Workday boards and two search terms, against a stand-in Workday
// server whose pages are laid out case by case. One job search collects from
// both boards, and the test reads back which jobs were collected and which
// pages were asked for under each term.
//
// The "pager" board holds most of the cases. Under "Product Designer" its
// second page holds a match while reporting a total of zero, and its third
// page holds no match at all. Under "UX Researcher" its first page holds a
// job whose age cannot be read, plus the one job both terms find, and its
// second page is empty. The "flood" board holds a match on every page under
// "Product Designer", so only the fifty-page ceiling ends that term, and no
// match at all under "UX Researcher".
//
// Real services run against a scratch database. The one thing standing in is
// Workday itself: global fetch is swapped for a stand-in server, so nothing
// here reaches a real website.
//
// Covers: Matching Workday jobs are collected, Non-matching Workday jobs are
// not collected, Each search term is searched separately, A job found by
// several terms is collected once, A Workday job with an unreadable age is
// still collected, Paging continues while pages hold matches, The reported
// total does not stop paging, Paging stops at a page with no match, Paging
// stops at an empty page, Paging stops at fifty pages.
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
import { createLastSuccessService } from "../services/last-success-service";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and a job search reading about a
// hundred pages runs after. A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const COLLECTED_AT = new Date("2026-09-01T10:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

const PRODUCT = "Product Designer";
const RESEARCH = "UX Researcher";

// Workday hands back 20 jobs a request. Asking for more returns nothing at all
// (measured 2026-09-21), which the stand-in copies.
const PAGE_SIZE = 20;

// The two boards, each stored as its company, data centre and site joined by
// a colon — the one text value a board row holds.
const PAGER = { company: "pager", host: "pager.wd1.myworkdayjobs.com", site: "Careers" };
const FLOOD = { company: "flood", host: "flood.wd1.myworkdayjobs.com", site: "Careers" };

interface Listing {
  title: string;
  externalPath: string;
  postedOn: string;
}

function listing(title: string, id: string, postedOn = "Posted 2 Days Ago"): Listing {
  const words = title.replace(/[^A-Za-z0-9]+/g, "-");
  return { title, externalPath: `/job/Remote-USA/${words}_${id}`, postedOn };
}

// Jobs matching neither search term, filling a page out to its full size so
// no page is short by accident. Each carries its own id, so no two are one
// posting.
function fillers(label: string, count: number): Listing[] {
  return Array.from({ length: count }, (_, index) =>
    listing(`Accountant ${label} ${index}`, `F-${label}-${index}`)
  );
}

// The job both terms find: the same posting, listed under each search.
const SHARED = listing("Product Designer", "P-SHARED");
// On the pager board's second "Product Designer" page.
const SECOND_PAGE_MATCH = listing("Senior Product Designer", "P-SECOND");
// Past the pager board's first page with no match, so never reached.
const PAST_NO_MATCH = listing("Staff Product Designer", "P-NEVER");
// Workday's own age wording, which the existing age reader cannot turn into a
// number of days (measured 2026-09-21).
const UNREADABLE_AGE = listing("UX Researcher", "U-AGE", "Posted 30+ Days Ago");
// Past the pager board's empty "UX Researcher" page, so never reached.
const PAST_EMPTY = listing("Lead UX Researcher", "U-NEVER");
// Past the flood board's first "UX Researcher" page, which holds no match.
const PAST_FLOOD_NO_MATCH = listing("Principal UX Researcher", "U-FLOOD-NEVER");

interface Page {
  total: number;
  jobPostings: Listing[];
}

const EMPTY: Page = { total: 0, jobPostings: [] };

// Every page the pager board serves, by term, in order. A page past the end
// of a list is empty.
const PAGER_PAGES: Record<string, Page[]> = {
  [PRODUCT]: [
    { total: 60, jobPostings: [SHARED, ...fillers("pd0", 19)] },
    // A match on a page reporting a total of zero, as Accenture's board
    // reported zero on every page after its first (measured 2026-09-21).
    { total: 0, jobPostings: [SECOND_PAGE_MATCH, ...fillers("pd1", 19)] },
    { total: 0, jobPostings: fillers("pd2", 20) },
    { total: 0, jobPostings: [PAST_NO_MATCH, ...fillers("pd3", 19)] },
  ],
  [RESEARCH]: [
    { total: 40, jobPostings: [UNREADABLE_AGE, SHARED, ...fillers("ux0", 18)] },
    EMPTY,
    { total: 0, jobPostings: [PAST_EMPTY, ...fillers("ux2", 19)] },
  ],
};

// The flood board holds a match on every page under "Product Designer", so
// only the ceiling ends that term. Under "UX Researcher" its first page holds
// no match.
function floodPage(term: string, index: number): Page {
  if (term === PRODUCT) {
    return {
      total: 5000,
      jobPostings: [listing(`Product Designer ${index}`, `FL-${index}`), ...fillers(`fl${index}`, 19)],
    };
  }
  if (term === RESEARCH) {
    if (index === 0) return { total: 5000, jobPostings: fillers("flux0", 20) };
    return { total: 0, jobPostings: [PAST_FLOOD_NO_MATCH, ...fillers(`flux${index}`, 19)] };
  }
  return EMPTY;
}

// One board search as the stand-in saw it.
interface Search {
  host: string;
  searchText: string;
  offset: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Stands in for Workday's board search: a POST to the board's job list, whose
// body names the search text, the offset and the page size. Every search is
// recorded. Anything else — a posting's own data address included — answers
// 404, because reading postings is not what this test is about.
function workdayStandIn(searches: Search[]): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const board = [PAGER, FLOOD].find((candidate) => candidate.host === url.host);
    const listPath = board && `/wday/cxs/${board.company}/${board.site}/jobs`.toLowerCase();

    if (!board || method !== "POST" || url.pathname.toLowerCase() !== listPath) {
      return json({ error: "not found" }, 404);
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      searchText?: string;
      offset?: number;
      limit?: number;
    };
    const searchText = body.searchText ?? "";
    const offset = body.offset ?? 0;
    searches.push({ host: board.host, searchText, offset });

    if (body.limit !== PAGE_SIZE) return json(EMPTY);

    const index = Math.floor(offset / PAGE_SIZE);
    const page =
      board === PAGER ? PAGER_PAGES[searchText]?.[index] ?? EMPTY : floodPage(searchText, index);
    return json(page);
  };
}

// A browser that stays wherever it is sent. A Workday listing is already the
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

describe("A job search polls a Workday board page by page", () => {
  const originalFetch = globalThis.fetch;
  const searches: Search[] = [];
  let dir: string;
  let db: PipelineDb;

  let collectedTitles: string[];
  let collectedCount: number;

  // The offsets asked for on one board under one term, in the order asked.
  const offsetsFor = (host: string, term: string) =>
    searches
      .filter((search) => search.host === host && search.searchText === term)
      .map((search) => search.offset);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-workday-paging-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const companies = createCompanyService(db);
    await db.setting.update({ where: { id: 1 }, data: { search_terms: [PRODUCT, RESEARCH] } });

    // Both boards are already promoted: each row names the Workday collector.
    for (const board of [PAGER, FLOOD]) {
      const { company } = await companies.create({ name: `${board.company} Inc` });
      await db.atsSlug.create({
        data: {
          slug: `${board.company}:wd1:${board.site}`,
          company_id: company.id,
          parser: "workday",
          collector: "workday",
        },
      });
    }

    globalThis.fetch = workdayStandIn(searches);

    await runJobSearch({
      settings: createSettingsService(db),
      companies,
      lastSuccesses: createLastSuccessService(db),
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      collectors: COLLECTORS.filter((collector) => collector.name === "workday"),
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      collectedAt: COLLECTED_AT,
      runId: "run-paging",
      trace: createTraceService(db),
      log: () => {},
    });

    const rows = await db.job.findMany({
      where: { collector: "workday" },
      select: { raw_title: true },
    });
    collectedTitles = rows.map((row) => row.raw_title ?? "");

    // Collection writes one of these rows for every job a collector hands
    // back, before duplicates are removed, so it counts what the collector
    // itself returned.
    collectedCount = await db.trace.count({
      where: { run_id: "run-paging", step: "collection", event: "job_collected", collector: "workday" },
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Matching Workday jobs are collected", () => {
    expect(collectedTitles).toEqual(
      expect.arrayContaining(["Product Designer", "Senior Product Designer", "Product Designer 0"])
    );
  });

  test("Non-matching Workday jobs are not collected", () => {
    expect(collectedTitles.filter((title) => title.startsWith("Accountant"))).toEqual([]);
  });

  test("Each search term is searched separately", () => {
    for (const board of [PAGER, FLOOD]) {
      const terms = new Set(
        searches.filter((search) => search.host === board.host).map((search) => search.searchText)
      );
      expect(terms).toEqual(new Set([PRODUCT, RESEARCH]));
    }
  });

  test("A job found by several terms is collected once", () => {
    // Three from the pager board, and one from each of the flood board's
    // fifty pages. The job both terms find counts once.
    expect(collectedCount).toBe(53);
  });

  test("A Workday job with an unreadable age is still collected", () => {
    expect(collectedTitles).toContain("UX Researcher");
  });

  test("Paging continues while pages hold matches", () => {
    expect(offsetsFor(PAGER.host, PRODUCT)).toContain(20);
    expect(collectedTitles).toContain("Senior Product Designer");
  });

  test("The reported total does not stop paging", () => {
    // The second page reported a total of zero and still held a match, so the
    // third page is asked for.
    expect(offsetsFor(PAGER.host, PRODUCT)).toContain(40);
  });

  test("Paging stops at a page with no match", () => {
    expect(offsetsFor(PAGER.host, PRODUCT)).toEqual([0, 20, 40]);
    expect(offsetsFor(FLOOD.host, RESEARCH)).toEqual([0]);
    expect(collectedTitles).not.toContain("Staff Product Designer");
    expect(collectedTitles).not.toContain("Principal UX Researcher");
  });

  test("Paging stops at an empty page", () => {
    expect(offsetsFor(PAGER.host, RESEARCH)).toEqual([0, 20]);
    expect(collectedTitles).not.toContain("Lead UX Researcher");
  });

  test("Paging stops at fifty pages", () => {
    expect(offsetsFor(FLOOD.host, PRODUCT)).toHaveLength(50);
  });
});
