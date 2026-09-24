// Flow test: A bad board reply skips only that board.
//
// Every collector that polls boards — Greenhouse, Lever, Ashby, Workday,
// UltiPro, Workable, Gem, SmartRecruiters, BambooHR and Rippling — is handed
// three promoted boards, in this order. The first answers
// with a page that is not job data. The request for the second fails outright,
// before any reply. The third answers properly with one matching job. One job
// search polls them all, and the test checks each collector carried on past
// both broken boards, named them in the warnings the run prints, and left
// every board on its polling list.
//
// Real services run against a scratch database. The one thing standing in is
// the job sites themselves: global fetch is swapped for a stand-in server, so
// nothing here reaches a real website.
//
// Covers: An unreadable reply skips only that board, A failed request skips
// only that board, A skipped board is reported, A board is never removed from
// polling.
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
import { issueLines } from "../utils/print-issues";
import { runJobSearch } from "./job-search";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and a job search runs after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

const COLLECTED_AT = new Date("2026-09-01T10:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

const ULTIPRO_BOARD_ID = "5b3c4d2e-7f10-4a2b-9c3d-4e5f6a7b8c9d";

// A board's name carries what it is set up to do, and the stand-in reads that
// off the address it is asked for. Each word appears in no other address.
const BROKEN_REPLY = "brokenreply";
const DEAD_REQUEST = "deadrequest";
const HEALTHY = "healthy";

// One collector's three boards, as the stored value its board row holds and
// as the word naming it in a warning.
interface Source {
  collector: string;
  // The stored board value for a board carrying the given marker.
  slug: (marker: string) => string;
  // The part of that value a warning has to name for a reader to find it.
  name: (marker: string) => string;
  // The title of the healthy board's one job. Each names its collector, so no
  // two collectors' jobs could be taken for one.
  title: string;
}

const SOURCES: Source[] = [
  {
    collector: "greenhouse",
    slug: (marker) => `gh-${marker}`,
    name: (marker) => `gh-${marker}`,
    title: "Product Designer, Greenhouse",
  },
  {
    collector: "lever",
    slug: (marker) => `lv-${marker}`,
    name: (marker) => `lv-${marker}`,
    title: "Product Designer, Lever",
  },
  {
    collector: "ashby",
    slug: (marker) => `ab-${marker}`,
    name: (marker) => `ab-${marker}`,
    title: "Product Designer, Ashby",
  },
  {
    // Company, data centre and site, joined by a colon.
    collector: "workday",
    slug: (marker) => `wd${marker}:wd1:Careers`,
    name: (marker) => `wd${marker}`,
    title: "Product Designer, Workday",
  },
  {
    // Company code and board id, joined by a colon.
    collector: "ultipro",
    slug: (marker) => `up${marker}:${ULTIPRO_BOARD_ID}`,
    name: (marker) => `up${marker}`,
    title: "Product Designer, UltiPro",
  },
  {
    collector: "workable",
    slug: (marker) => `wk-${marker}`,
    name: (marker) => `wk-${marker}`,
    title: "Product Designer, Workable",
  },
  {
    collector: "gem",
    slug: (marker) => `gm-${marker}`,
    name: (marker) => `gm-${marker}`,
    title: "Product Designer, Gem",
  },
  {
    collector: "smartrecruiters",
    slug: (marker) => `sr-${marker}`,
    name: (marker) => `sr-${marker}`,
    title: "Product Designer, SmartRecruiters",
  },
  {
    // The board name is the first part of the board's web address.
    collector: "bamboohr",
    slug: (marker) => `bh-${marker}`,
    name: (marker) => `bh-${marker}`,
    title: "Product Designer, BambooHR",
  },
  {
    collector: "rippling",
    slug: (marker) => `rp-${marker}`,
    name: (marker) => `rp-${marker}`,
    title: "Product Designer, Rippling",
  },
];

const titleFor = (collector: string) =>
  SOURCES.find((source) => source.collector === collector)?.title ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The healthy board's job list, in each source's own reply shape. Null means
// the request is not a board's job list — a posting a parser reads after
// collection, for instance — and answers 404.
function healthyList(url: URL, method: string, body: string): Response | null {
  const segments = url.pathname.split("/").filter(Boolean);

  if (url.host === "boards-api.greenhouse.io" && segments.at(-1) === "jobs") {
    return json({
      jobs: [
        {
          id: 7001,
          title: titleFor("greenhouse"),
          first_published: "2026-08-28T00:00:00Z",
          updated_at: "2026-08-29T00:00:00Z",
          location: { name: "Remote" },
          content: "<p>Design for the healthy board.</p>",
          company_name: "Healthy Greenhouse Co",
        },
      ],
    });
  }

  if (url.host === "api.lever.co" && segments.length === 3) {
    return json([
      {
        id: "lv-7001",
        text: titleFor("lever"),
        createdAt: Date.parse("2026-08-28T00:00:00Z"),
        categories: { location: "Remote" },
        descriptionPlain: "Design for the healthy board.",
      },
    ]);
  }

  if (url.host === "api.ashbyhq.com") {
    return json({
      jobs: [
        {
          title: titleFor("ashby"),
          isListed: true,
          jobUrl: "https://jobs.ashbyhq.com/ab-healthy/ab-7001",
          publishedAt: "2026-08-28T00:00:00Z",
          location: "Remote",
          descriptionPlain: "Design for the healthy board.",
        },
      ],
    });
  }

  if (url.host.endsWith(".myworkdayjobs.com") && method === "POST" && segments.at(-1) === "jobs") {
    const { offset = 0 } = JSON.parse(body || "{}") as { offset?: number };
    if (offset > 0) return json({ total: 0, jobPostings: [] });
    return json({
      total: 1,
      jobPostings: [
        {
          title: titleFor("workday"),
          externalPath: "/job/Remote/Product-Designer--Workday_WD-7001",
          locationsText: "Remote",
          postedOn: "Posted Today",
        },
      ],
    });
  }

  if (
    url.host === "recruiting.ultipro.com" &&
    method === "POST" &&
    url.pathname.toLowerCase().endsWith("/jobboardview/loadsearchresults")
  ) {
    const { opportunitySearch } = JSON.parse(body || "{}") as {
      opportunitySearch?: { Skip?: number };
    };
    if ((opportunitySearch?.Skip ?? 0) > 0) return json({ opportunities: [], totalCount: 1 });
    return json({
      opportunities: [
        {
          Id: "00000000-0000-4000-8000-000000007001",
          Title: titleFor("ultipro"),
          FullTime: true,
          Locations: [
            {
              LocalizedName: "Remote",
              Address: {
                City: "Austin",
                State: { Code: "TX", Name: "Texas" },
                Country: { Code: "USA", Name: "United States" },
              },
            },
          ],
          PostedDate: "2026-08-28T15:00:00.000Z",
          BriefDescription: "Design for the healthy board.",
        },
      ],
      totalCount: 1,
    });
  }

  // The five below answer at the board list addresses the ATS and HR System
  // Parser Expansion spec names, in the shapes measured live on 2026-09-24.
  if (url.host === "apply.workable.com" && segments.slice(0, 4).join("/") === "api/v1/widget/accounts") {
    return json({
      name: "Healthy Workable Co",
      description: "",
      jobs: [
        {
          title: titleFor("workable"),
          shortcode: "WK7001AAAA",
          employment_type: "Full-time",
          telecommuting: true,
          url: "https://apply.workable.com/j/WK7001AAAA",
          shortlink: "https://apply.workable.com/j/WK7001AAAA",
          published_on: "2026-08-28",
          created_at: "2026-08-28",
          country: "United States",
          city: "Austin",
          state: "Texas",
          locations: [],
        },
      ],
    });
  }

  if (url.host === "api.gem.com" && segments.at(-1) === "job_posts") {
    return json([
      {
        absolute_url: "https://jobs.gem.com/gm-healthy/7001",
        content: "<p>Design for the healthy board.</p>",
        content_plain: "Design for the healthy board.",
        created_at: "2026-08-28T00:00:00.000Z",
        first_published_at: "2026-08-28T00:00:00.000Z",
        id: "7001",
        location: { name: "Remote" },
        title: titleFor("gem"),
        updated_at: "2026-08-29T00:00:00.000Z",
      },
    ]);
  }

  if (url.host === "api.smartrecruiters.com" && segments.at(-1) === "postings") {
    if (Number(url.searchParams.get("offset") ?? "0") > 0) {
      return json({ offset: 100, limit: 100, totalFound: 1, content: [] });
    }
    return json({
      offset: 0,
      limit: 100,
      totalFound: 1,
      content: [
        {
          id: "744000000007001",
          name: titleFor("smartrecruiters"),
          company: { identifier: "sr-healthy", name: "Healthy SmartRecruiters Co" },
          releasedDate: "2026-08-28T00:00:00.000Z",
          location: { city: "Austin", region: "TX", country: "us", fullLocation: "Austin, TX, United States" },
        },
      ],
    });
  }

  if (url.host.endsWith(".bamboohr.com") && url.pathname === "/careers/list") {
    return json({
      meta: { totalCount: 1 },
      result: [
        {
          id: "7001",
          jobOpeningName: titleFor("bamboohr"),
          departmentLabel: "Product",
          employmentStatusLabel: "Full-Time",
          location: { city: null, state: null },
          atsLocation: { country: "United States", state: "Texas", province: null, city: "Austin" },
        },
      ],
    });
  }

  if (url.host === "api.rippling.com" && segments.at(-1) === "jobs") {
    return json([
      {
        uuid: "00000000-0000-4000-8000-000000007001",
        name: titleFor("rippling"),
        department: { id: "Product", label: "Product" },
        url: "https://ats.rippling.com/rp-healthy/jobs/00000000-0000-4000-8000-000000007001",
        workLocation: { label: "Austin, TX", id: "Austin, TX" },
      },
    ]);
  }

  return null;
}

// Stands in for every job site at once, deciding by the board named in the
// address. A broken board answers with an error page where job data should be.
// A dead board's request fails before any reply, the way a dropped connection
// does. A healthy board answers properly. Every address asked for is recorded,
// so a test can check a board was reached whatever it answered.
function standIn(addresses: string[]): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const address = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    addresses.push(address);

    if (address.includes(BROKEN_REPLY)) {
      return new Response("<html><body>Service temporarily unavailable</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (address.includes(DEAD_REQUEST)) {
      throw new TypeError("fetch failed");
    }
    if (address.includes(HEALTHY)) {
      const reply = healthyList(new URL(address), method, String(init?.body ?? ""));
      if (reply) return reply;
    }
    return json({ error: "not found" }, 404);
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

describe("A bad board reply skips only that board", () => {
  const originalFetch = globalThis.fetch;
  const addresses: string[] = [];
  let dir: string;
  let db: PipelineDb;
  let collectedTitles: string[];
  let printedWarnings: string;
  let boardsAfter: { slug: string; collector: string | null }[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-broken-board-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const companies = createCompanyService(db);

    // Every board is already promoted: each row names its collector. They are
    // written one at a time in this order, which is the order a collector
    // reads them back in, so each healthy board is polled last.
    for (const source of SOURCES) {
      for (const marker of [BROKEN_REPLY, DEAD_REQUEST, HEALTHY]) {
        const { company } = await companies.create({ name: `${source.name(marker)} Co` });
        await db.atsSlug.create({
          data: {
            slug: source.slug(marker),
            company_id: company.id,
            parser: source.collector,
            collector: source.collector,
          },
        });
      }
    }

    globalThis.fetch = standIn(addresses);

    const collectorNames = new Set(SOURCES.map((source) => source.collector));
    const report = await runJobSearch({
      settings: createSettingsService(db),
      companies,
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      collectors: COLLECTORS.filter((collector) => collectorNames.has(collector.name)),
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      collectedAt: COLLECTED_AT,
      runId: "run-broken-board",
      trace: createTraceService(db),
      log: () => {},
    });

    // Exactly what the job-search command prints under its warnings heading.
    printedWarnings = issueLines("Warnings", report.warnings).join("\n");

    const rows = await db.job.findMany({ select: { raw_title: true } });
    collectedTitles = rows.map((row) => row.raw_title ?? "");

    boardsAfter = await db.atsSlug.findMany({ select: { slug: true, collector: true } });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  describe.each(SOURCES)("$collector", (source) => {
    test("An unreadable reply skips only that board", () => {
      // The dead board comes straight after the broken one, so a request sent
      // for it means the collector carried on past the unreadable reply.
      expect(addresses.some((address) => address.includes(source.name(DEAD_REQUEST)))).toBe(true);
    });

    test("A failed request skips only that board", () => {
      // The healthy board comes straight after the dead one, so its job
      // arriving means the collector carried on past the failed request.
      expect(collectedTitles).toContain(source.title);
    });

    test("A skipped board is reported", () => {
      expect(printedWarnings).toContain(source.name(BROKEN_REPLY));
      expect(printedWarnings).toContain(source.name(DEAD_REQUEST));
    });

    test("A board is never removed from polling", () => {
      for (const marker of [BROKEN_REPLY, DEAD_REQUEST, HEALTHY]) {
        expect(boardsAfter).toContainEqual({
          slug: source.slug(marker),
          collector: source.collector,
        });
      }
    });
  });
});
