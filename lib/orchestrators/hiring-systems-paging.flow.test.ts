// Flow test: A job search polls each board to its last page.
//
// Each of the five systems — Workable, Gem, SmartRecruiters, BambooHR and
// Rippling — has two promoted boards. The "full" board lists jobs matching
// each of two search terms and one matching neither. The "quiet" board lists
// no jobs at all, as an employer that paused hiring or moved systems does.
// SmartRecruiters' full board holds more jobs than one reply returns, with a
// match only past the first reply: it hands back 100 jobs a reply, and
// ServiceNow's board listed 686 when measured on 2026-09-24. The other four
// returned a whole board in one reply.
//
// A Dover board is on a polling list too, promoted under a Dover collector.
// Dover's robots.txt disallows its data feeds, so no collector may send it a
// request, whatever the board table says.
//
// One job search runs every collector the registry names, and the test checks
// which jobs were collected, that each quiet board was asked for and is still
// on its polling list, and that nothing was sent to Dover.
//
// Real services run against a scratch database. The one thing standing in is
// the job sites themselves: global fetch is swapped for a stand-in server
// answering each system's board list address, in the shapes those addresses
// returned when measured live on 2026-09-24. Nothing here reaches a real
// website.
//
// Covers: Matching jobs are collected, Non-matching jobs are not collected, A
// board is read to its last page, An empty board stays on its polling list, No
// collector polls Dover.
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

const PRODUCT = "Product Designer";
const RESEARCH = "UX Researcher";

// The titles on every full board: one per search term and one matching
// neither.
const PRODUCT_TITLE = "Senior Product Designer";
const RESEARCH_TITLE = "UX Researcher, Payments";
const OTHER_TITLE = "Accounts Payable Clerk";

// SmartRecruiters hands back 100 jobs a reply (measured 2026-09-24).
const SMARTRECRUITERS_PAGE_SIZE = 100;
// A match that sits only past SmartRecruiters' first reply.
const PAST_FIRST_REPLY_TITLE = "Lead UX Researcher, Page Two";

// A system's two boards, each named for the system so the stand-in can tell
// every board apart by the name in its address alone.
const SYSTEMS = ["workable", "gem", "smartrecruiters", "bamboohr", "rippling"] as const;
type SystemName = (typeof SYSTEMS)[number];

const fullBoard = (system: SystemName) => `full${system}`;
const quietBoard = (system: SystemName) => `quiet${system}`;

interface Listing {
  id: string;
  title: string;
}

// The jobs each board lists, by board name. A quiet board lists none.
function listingsFor(board: string): Listing[] {
  const system = SYSTEMS.find((name) => board === fullBoard(name));
  if (!system) return [];

  const listing = (suffix: string, title: string) => ({ id: `${system}-${suffix}`, title });
  const core = [
    listing("1", PRODUCT_TITLE),
    listing("2", RESEARCH_TITLE),
    listing("3", OTHER_TITLE),
  ];
  if (system !== "smartrecruiters") return core;

  // Enough jobs matching no term to push one match past the first reply.
  const fillers = Array.from({ length: SMARTRECRUITERS_PAGE_SIZE + 20 }, (_, index) =>
    listing(`filler-${index}`, `Warehouse Associate ${index}`)
  );
  return [...core, ...fillers, listing("past", PAST_FIRST_REPLY_TITLE)];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const notFound = () => json({ error: "not found" }, 404);

// A numeric identifier for systems whose identifiers are numbers. Handed out
// in sequence and remembered, so no two listings can ever share one — two
// listings sharing an identifier share a link, and duplicate matching would
// rightly fold them into one job.
const numericIds = new Map<string, string>();
const numericId = (listing: Listing) => {
  let id = numericIds.get(listing.id);
  if (id === undefined) {
    id = String(7_000_000_000 + numericIds.size);
    numericIds.set(listing.id, id);
  }
  return id;
};

// A board's job list at the address each system's collector asks for, or null
// where the address is not a board's job list. Each is shaped the way that
// address answered when measured on 2026-09-24.
function boardList(url: URL): { board: string; reply: Response } | null {
  const workable = url.host === "apply.workable.com" && url.pathname.match(/^\/api\/v1\/widget\/accounts\/([^/]+)$/);
  if (workable) {
    const board = workable[1] ?? "";
    return {
      board,
      reply: json({
        name: `${board} Co`,
        description: "",
        jobs: listingsFor(board).map((listing) => ({
          title: listing.title,
          shortcode: listing.id.toUpperCase(),
          employment_type: "Full-time",
          telecommuting: true,
          url: `https://apply.workable.com/j/${listing.id.toUpperCase()}`,
          shortlink: `https://apply.workable.com/j/${listing.id.toUpperCase()}`,
          published_on: "2026-08-30",
          created_at: "2026-08-28",
          country: "United States",
          city: "Austin",
          state: "Texas",
          locations: [],
        })),
      }),
    };
  }

  const gem = url.host === "api.gem.com" && url.pathname.match(/^\/job_board\/v0\/([^/]+)\/job_posts\/?$/);
  if (gem) {
    const board = gem[1] ?? "";
    return {
      board,
      reply: json(
        listingsFor(board).map((listing) => ({
          absolute_url: `https://jobs.gem.com/${board}/${numericId(listing)}`,
          content: "<p>A role.</p>",
          content_plain: "A role.",
          created_at: "2026-08-28T22:26:01.000Z",
          first_published_at: "2026-08-30T22:51:02.331Z",
          id: numericId(listing),
          location: { name: "Austin, TX" },
          title: listing.title,
          updated_at: "2026-08-31T16:08:06.647Z",
        }))
      ),
    };
  }

  const smartRecruiters =
    url.host === "api.smartrecruiters.com" && url.pathname.match(/^\/v1\/companies\/([^/]+)\/postings$/);
  if (smartRecruiters) {
    const board = smartRecruiters[1] ?? "";
    const all = listingsFor(board);
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const asked = Number(url.searchParams.get("limit") ?? String(SMARTRECRUITERS_PAGE_SIZE));
    const limit = Math.min(asked, SMARTRECRUITERS_PAGE_SIZE);
    return {
      board,
      reply: json({
        offset,
        limit,
        totalFound: all.length,
        content: all.slice(offset, offset + limit).map((listing) => ({
          id: numericId(listing),
          name: listing.title,
          company: { identifier: board, name: `${board} Co` },
          releasedDate: "2026-08-30T15:40:10.388Z",
          location: { city: "Austin", region: "TX", country: "us", fullLocation: "Austin, TX, United States" },
        })),
      }),
    };
  }

  if (url.host.endsWith(".bamboohr.com") && url.pathname === "/careers/list") {
    const board = url.host.slice(0, -".bamboohr.com".length);
    const all = listingsFor(board);
    return {
      board,
      reply: json({
        meta: { totalCount: all.length },
        result: all.map((listing) => ({
          id: numericId(listing),
          jobOpeningName: listing.title,
          departmentLabel: "Product",
          employmentStatusLabel: "Full-Time",
          location: { city: null, state: null },
          atsLocation: { country: "United States", state: "Texas", province: null, city: "Austin" },
        })),
      }),
    };
  }

  const rippling =
    url.host === "api.rippling.com" && url.pathname.match(/^\/platform\/api\/ats\/v1\/board\/([^/]+)\/jobs$/);
  if (rippling) {
    const board = rippling[1] ?? "";
    return {
      board,
      reply: json(
        listingsFor(board).map((listing) => ({
          uuid: `00000000-0000-4000-8000-${numericId(listing).padStart(12, "0")}`,
          name: listing.title,
          department: { id: "Product", label: "Product" },
          url: `https://ats.rippling.com/${board}/jobs/00000000-0000-4000-8000-${numericId(listing).padStart(12, "0")}`,
          workLocation: { label: "Austin, TX", id: "Austin, TX" },
        }))
      ),
    };
  }

  return null;
}

// Stands in for every job site at once. Every address asked for is recorded,
// so a test can check which boards were reached and that Dover never was. A
// posting's own address, which a parser reads after collection, answers 404,
// because reading postings is not what this test is about.
function standIn(addresses: URL[], boardsAsked: string[]): typeof fetch {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    addresses.push(url);
    const list = boardList(url);
    if (!list) return notFound();
    boardsAsked.push(list.board);
    return list.reply;
  };
}

// A browser that stays wherever it is sent. A board's listing is already the
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

describe("A job search polls each board to its last page", () => {
  const originalFetch = globalThis.fetch;
  const addresses: URL[] = [];
  const boardsAsked: string[] = [];
  let dir: string;
  let db: PipelineDb;
  const collectedTitles: Record<string, string[]> = {};
  let boardsAfter: { slug: string; collector: string | null }[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-hiring-systems-paging-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const companies = createCompanyService(db);
    await db.setting.update({ where: { id: 1 }, data: { search_terms: [PRODUCT, RESEARCH] } });

    // Every board is already promoted: each row names its system's collector.
    const promoted = [
      ...SYSTEMS.flatMap((system) => [
        { slug: fullBoard(system), system: system as string },
        { slug: quietBoard(system), system: system as string },
      ]),
      { slug: "fulldover", system: "dover" },
    ];
    for (const board of promoted) {
      const { company } = await companies.create({ name: `${board.slug} Co` });
      await db.atsSlug.create({
        data: { slug: board.slug, company_id: company.id, parser: board.system, collector: board.system },
      });
    }

    globalThis.fetch = standIn(addresses, boardsAsked);

    // Every collector the registry names, so no collector is left out of the
    // question of whether any reaches Dover.
    await runJobSearch({
      settings: createSettingsService(db),
      companies,
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      collectors: COLLECTORS,
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      collectedAt: COLLECTED_AT,
      runId: "run-paging",
      trace: createTraceService(db),
      log: () => {},
    });

    for (const system of SYSTEMS) {
      const rows = await db.job.findMany({ where: { collector: system }, select: { raw_title: true } });
      collectedTitles[system] = rows.map((row) => row.raw_title ?? "");
    }
    boardsAfter = await db.atsSlug.findMany({ select: { slug: true, collector: true } });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  describe.each(SYSTEMS)("%s", (system) => {
    test("Matching jobs are collected", () => {
      expect(collectedTitles[system]).toEqual(expect.arrayContaining([PRODUCT_TITLE, RESEARCH_TITLE]));
    });

    test("Non-matching jobs are not collected", () => {
      const titles = collectedTitles[system] ?? [];
      expect(titles.length).toBeGreaterThan(0);
      expect(titles).not.toContain(OTHER_TITLE);
      expect(titles.filter((title) => title.startsWith("Warehouse Associate"))).toEqual([]);
    });

    test("An empty board stays on its polling list", () => {
      // The quiet board was asked for its jobs, and answered none.
      expect(boardsAsked).toContain(quietBoard(system));
      expect(boardsAfter).toContainEqual({ slug: quietBoard(system), collector: system });
    });
  });

  test("A board is read to its last page", () => {
    expect(collectedTitles["smartrecruiters"]).toContain(PAST_FIRST_REPLY_TITLE);
  });

  test("No collector polls Dover", () => {
    expect(addresses.filter((url) => url.host.endsWith("dover.com"))).toEqual([]);
  });
});
