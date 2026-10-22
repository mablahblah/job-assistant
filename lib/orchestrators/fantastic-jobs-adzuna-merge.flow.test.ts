// Flow test: A Fantastic.jobs copy of a job beats an aggregator's copy.
//
// The source ranking is set to what the feature's migration leaves on an
// existing database: Fantastic.jobs directly after Workable, above the scraping
// and API collectors. Two job searches run. In the first, Adzuna and
// Fantastic.jobs return the same job; in the second, JSearch and Fantastic.jobs
// do. Each pair carries different links and different posted dates, and the
// aggregator's date is the earlier one, so the date cannot follow the ranking.
//
// Real services run against a scratch database. The one thing standing in is
// every website: global fetch is swapped for a stand-in answering Apify,
// Adzuna, JSearch and the employers' pages, so the real collectors run, and
// nothing here reaches a paid service.
//
// Covers: Wins over Adzuna, Keeps the earliest posted date.
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
import { runJobSearch } from "./job-search";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and two job searches run after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

const COLLECTOR = "fantastic-jobs";
const APIFY_HOST = "api.apify.com";

// Every environment variable the three keyed sources read. Each is set to a
// stand-in value for the run and put back after, so no real key is sent
// anywhere, even to the stand-in.
const KEY_VARIABLES = [
  "FANTASTIC_JOBS_APIFY_TOKEN",
  "ADZUNA_APP_ID",
  "ADZUNA_API_KEY",
  "RAPIDAPI_KEY",
];
const standInValue = (variable: string) => `stand-in-${variable.toLowerCase()}`;

// The Fantastic.jobs settings, by the column each is stored in. setSetting
// below writes one of them by its column name.
const TOWNS = "search_towns";
const REMOTE_LABELS = "remote_labels";
const EXCLUDED_TITLES = "excluded_titles";
const WINDOW_DAYS = "search_window_days";

const ADZUNA_RUN = { id: "run-with-adzuna", at: new Date("2026-09-22T15:00:00.000Z") };
const JSEARCH_RUN = { id: "run-with-jsearch", at: new Date("2026-09-23T15:00:00.000Z") };

// One job each aggregator shares with the service: the same employer and
// title, a different link, and an earlier posted date on the aggregator's
// side.
const WITH_ADZUNA = {
  employer: "Northwind Labs",
  title: "Senior Product Designer",
  aggregatorLink: "https://www.adzuna.com/land/ad/5012345678?se=abc&utm_medium=api",
  aggregatorPosted: "2026-09-20T09:00:00Z",
  serviceLink: "https://jobs.northwind.example/careers/42",
  servicePosted: "2026-09-21T14:00:00",
  serviceFirstFound: "2026-09-21T14:30:00",
};
const WITH_JSEARCH = {
  employer: "Brightline Freight",
  title: "Lead Product Designer",
  aggregatorLink: "https://jobs.aggregated.example/view/998877",
  aggregatorPosted: "2026-09-19T08:00:00.000Z",
  serviceLink: "https://careers.brightline.example/openings/7",
  servicePosted: "2026-09-21T16:00:00",
  serviceFirstFound: "2026-09-21T16:20:00",
};

// The job the service and one aggregator share in a job search.
type Pair = typeof WITH_ADZUNA;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// An employer's page publishing job data that names no place and no date, so
// the places and dates the sources gave stand.
function employerPage(): Response {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "A role",
    description: "<p>Design the product.</p>",
  };
  return new Response(
    "<!DOCTYPE html><html><head><title>Careers</title>" +
      `<script type="application/ld+json">${JSON.stringify(block)}</script>` +
      "</head><body><p>Design the product.</p></body></html>",
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

// Stands in for every website. Each source returns the pair this job search
// shares from its remote search only, so each job arrives once per source.
function standIn(state: { pair: Pair }): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const pair = state.pair;

    if (url.host === APIFY_HOST) {
      if (typeof init?.body !== "string") throw new Error("an Apify request carried no JSON body");
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const locations = Array.isArray(body["locationSearch"]) ? body["locationSearch"] : [];
      if (!locations.includes("United States")) return json([], 201);
      return json(
        [
          {
            id: "2426526900",
            title: pair.title,
            organization: pair.employer,
            url: pair.serviceLink,
            date_posted: pair.servicePosted,
            date_created: pair.serviceFirstFound,
            source_type: "ats",
            locations_derived: ["Austin, Texas, United States"],
            countries_derived: ["United States"],
            ai_work_arrangement: "Remote OK",
            ai_remote_location: ["United States"],
            description_text: "Design the product.",
          },
        ],
        201
      );
    }

    if (url.host === "api.adzuna.com") {
      const remote = url.searchParams.get("what") === "remote";
      const results =
        remote && pair === WITH_ADZUNA
          ? [
              {
                id: "5012345678",
                title: pair.title,
                company: { display_name: pair.employer },
                redirect_url: pair.aggregatorLink,
                location: { display_name: "Austin, Travis County" },
                created: pair.aggregatorPosted,
                description: "Design the product.",
              },
            ]
          : [];
      return json({ results, count: results.length }, 200);
    }

    if (url.host === "jsearch.p.rapidapi.com") {
      const remote = url.searchParams.get("work_from_home") === "true";
      const data =
        remote && pair === WITH_JSEARCH
          ? [
              {
                job_id: "jsearch-998877",
                job_title: pair.title,
                employer_name: pair.employer,
                job_apply_link: pair.aggregatorLink,
                job_city: "Austin",
                job_state: "TX",
                job_country: "US",
                job_is_remote: true,
                job_posted_at_datetime_utc: pair.aggregatorPosted,
                job_description: "Design the product.",
              },
            ]
          : [];
      return json({ status: "OK", data }, 200);
    }

    if (url.href === pair.serviceLink || url.href === pair.aggregatorLink) return employerPage();
    return json({ error: "not found" }, 404);
  };
}

// A browser that stays wherever it is sent, so a job that reaches resolution
// keeps the link it arrived with.
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

async function setSetting(db: PipelineDb, column: string, value: unknown): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE Setting SET ${column} = ? WHERE id = 1`,
    typeof value === "number" ? value : JSON.stringify(value)
  );
}

// Answers every place lookup with the user's own city, so the run never
// reaches a mapping service.
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

interface SavedJob {
  original_url: string | null;
  resolved_url: string | null;
  posting_date: Date | null;
}

describe("A Fantastic.jobs copy of a job beats an aggregator's copy", () => {
  const originalFetch = globalThis.fetch;
  const originalValues = Object.fromEntries(
    KEY_VARIABLES.map((variable) => [variable, process.env[variable]])
  );
  const state: { pair: Pair } = { pair: WITH_ADZUNA };
  const saved: Record<string, SavedJob[]> = {};
  let dir: string;
  let db: PipelineDb;

  const jobFor = (pair: Pair): SavedJob => {
    const rows = saved[pair.title] ?? [];
    if (rows.length !== 1) throw new Error(`${rows.length} jobs saved as "${pair.title}"`);
    return rows[0] as SavedJob;
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-fantastic-jobs-merge-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    await db.setting.update({
      where: { id: 1 },
      data: {
        search_terms: ["Product Design"],
        expiry_threshold: 8,
        source_priority_list: LIVE_RANKING,
      },
    });
    await setSetting(db, TOWNS, ["Austin, Texas, United States"]);
    await setSetting(db, REMOTE_LABELS, ["Remote OK", "Remote Solely"]);
    await setSetting(db, EXCLUDED_TITLES, []);
    await setSetting(db, WINDOW_DAYS, 7);

    for (const variable of KEY_VARIABLES) process.env[variable] = standInValue(variable);
    globalThis.fetch = standIn(state);

    const shared = {
      settings,
      companies: createCompanyService(db),
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      lastSuccesses: createLastSuccessService(db),
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      // Every page here answers a plain request, so no parser needs a browser,
      // and none may open one on the real web.
      launchParsingBrowser: async () => {
        throw new Error("this test opens no parsing browser");
      },
      places,
      geocoder: fakeGeocoder(),
      trace: createTraceService(db),
      log: () => {},
    };
    const collectorsNamed = (...names: string[]) =>
      COLLECTORS.filter((collector) => names.includes(collector.name));

    state.pair = WITH_ADZUNA;
    await runJobSearch({
      ...shared,
      collectors: collectorsNamed("adzuna", COLLECTOR),
      collectedAt: ADZUNA_RUN.at,
      runId: ADZUNA_RUN.id,
    });

    state.pair = WITH_JSEARCH;
    await runJobSearch({
      ...shared,
      collectors: collectorsNamed("jsearch", COLLECTOR),
      collectedAt: JSEARCH_RUN.at,
      runId: JSEARCH_RUN.id,
    });

    for (const pair of [WITH_ADZUNA, WITH_JSEARCH]) {
      saved[pair.title] = await db.job.findMany({
        where: { raw_title: pair.title },
        select: { original_url: true, resolved_url: true, posting_date: true },
      });
    }
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    for (const [variable, value] of Object.entries(originalValues)) {
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Wins over Adzuna", () => {
    // Both copies carry a link where the job was found, so the ranking decides
    // it; only the service's copy carries a posting link.
    for (const pair of [WITH_ADZUNA, WITH_JSEARCH]) {
      expect(jobFor(pair).original_url).toBe(pair.serviceLink);
      expect(jobFor(pair).resolved_url).toBe(pair.serviceLink);
    }
  });

  test("Keeps the earliest posted date", () => {
    for (const pair of [WITH_ADZUNA, WITH_JSEARCH]) {
      expect(jobFor(pair).posting_date?.toISOString()).toBe(
        new Date(pair.aggregatorPosted).toISOString()
      );
    }
  });
});
