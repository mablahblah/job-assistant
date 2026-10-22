// Flow test: Adding a job by hand sends no paid search.
//
// With the Fantastic.jobs token and every Fantastic.jobs setting in place, one
// job is added by its link through add-external-jobs. The test checks that no
// request reached Apify, so adding a job never spends money.
//
// Real services run against a scratch database. The one thing standing in is
// every website: global fetch is swapped for a stand-in that records every
// request and answers the added job's page, so nothing here reaches a paid
// service.
//
// Covers: Never runs when adding jobs by hand.
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
import { runAddExternalJobs } from "./add-external-jobs";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and one run follows. A ceiling
// rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const ADDED_AT = new Date("2026-10-01T15:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

const TOKEN_VARIABLE = "FANTASTIC_JOBS_APIFY_TOKEN";
const APIFY_HOST = "api.apify.com";

// The Fantastic.jobs settings, by the column each is stored in. The columns
// are new with this feature, so they are written with plain SQL, the way
// ultipro-dedupe.flow.test.ts wrote a column before the client knew it.
const TOWNS = "search_towns";
const REMOTE_LABELS = "remote_labels";
const EXCLUDED_TITLES = "excluded_titles";
const WINDOW_DAYS = "search_window_days";

const ADDED_LINK = "https://careers.dunmore.example/jobs/101";

// The added job's page: job data naming a place near home.
function postingPage(): Response {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Product Designer",
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: "Austin", addressRegion: "TX" },
    },
    description: "<p>Design the tools Dunmore's freight teams use every day.</p>",
  };
  return new Response(
    "<!DOCTYPE html><html><head><title>Careers</title>" +
      `<script type="application/ld+json">${JSON.stringify(block)}</script>` +
      "</head><body><p>Design the tools Dunmore's freight teams use every day.</p></body></html>",
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

// Records every request and answers only the added job's page. Apify answers
// a finished run with no jobs, so a search that was sent would not break the
// run and hide itself.
function standIn(requested: URL[]): typeof fetch {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requested.push(url);
    if (url.host === APIFY_HOST) {
      return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
    }
    if (url.href === ADDED_LINK) return postingPage();
    return new Response("Not found", { status: 404 });
  };
}

// A browser that stays wherever it is sent, so the added link is its own
// posting.
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

describe("Adding a job by hand sends no paid search", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env[TOKEN_VARIABLE];
  const requested: URL[] = [];
  let addedJobId: string | null | undefined;
  let dir: string;
  let db: PipelineDb;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-fantastic-jobs-add-external-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    await setSetting(db, TOWNS, ["Austin, Texas, United States"]);
    await setSetting(db, REMOTE_LABELS, ["Remote OK", "Remote Solely"]);
    await setSetting(db, EXCLUDED_TITLES, ["Director"]);
    await setSetting(db, WINDOW_DAYS, 7);

    process.env[TOKEN_VARIABLE] = "stand-in-fantastic-jobs-token";
    globalThis.fetch = standIn(requested);

    const added = await runAddExternalJobs({
      submissions: [
        {
          link: ADDED_LINK,
          title: "Product Designer",
          employer: "Dunmore",
          description: "Design the tools Dunmore's freight teams use every day.",
        },
      ],
      settings: createSettingsService(db),
      companies: createCompanyService(db),
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      // The added page answers a plain request, so no parser needs a browser,
      // and none may open one on the real web.
      launchParsingBrowser: async () => {
        throw new Error("this test opens no parsing browser");
      },
      places,
      geocoder: fakeGeocoder(),
      collectedAt: ADDED_AT,
      runId: "run-add-by-hand",
      trace: createTraceService(db),
      log: () => {},
    });
    addedJobId = added.outcomes[0]?.jobId;
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env[TOKEN_VARIABLE];
    else process.env[TOKEN_VARIABLE] = originalToken;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Never runs when adding jobs by hand", () => {
    // The job was added, so the run went all the way through.
    expect(addedJobId ?? null).not.toBeNull();
    expect(requested.some((url) => url.href === ADDED_LINK)).toBe(true);
    expect(requested.filter((url) => url.host === APIFY_HOST)).toHaveLength(0);
  });
});
