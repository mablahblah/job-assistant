// Flow test: What an empty list does to a job search and to Fantastic.jobs.
//
// Job searches run with no search terms, with only blank search terms, with no
// towns, with no remote labels, and with neither towns nor remote labels. A
// polled Greenhouse board sits beside Fantastic.jobs throughout, so the test
// can see whether any source ran at all.
//
// Real services run against a scratch database. The one thing standing in is
// every website: global fetch is swapped for a stand-in answering Apify and the
// Greenhouse board, so the real collectors and the real Apify tool run, and
// nothing here reaches a paid service.
//
// Covers: Refuses to start with no search terms, Names the empty search terms,
// Changes nothing when refusing, Refuses with only blank search terms, Skips the
// Austin search with no towns, Skips the remote search with no remote labels,
// Reports an error when both searches are switched off, Says nothing about a
// switched-off search.
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
import type { CollectionIssue } from "../types/collection-issue";
import { COLLECTORS } from "../collectors/registry";
import { runJobSearch, type RunJobSearchResult } from "./job-search";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and five job searches run after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

const COLLECTOR = "fantastic-jobs";
const TOKEN = "apify_api_EmptySettingsFlowToken2Wp4";
const APIFY_HOST = "api.apify.com";

// The Fantastic.jobs settings, by the column each is stored in. The columns
// are new with this feature, so they are written with plain SQL, the way
// ultipro-dedupe.flow.test.ts wrote a column before the client knew it.
const TOWNS = "search_towns";
const REMOTE_LABELS = "remote_labels";
const EXCLUDED_TITLES = "excluded_titles";
const WINDOW_DAYS = "search_window_days";

const SEARCH_TERMS = ["Product Design"];
const AUSTIN_TOWNS = ["Austin, Texas, United States"];
const LABELS = ["Remote OK", "Remote Solely"];

// The polled board running beside Fantastic.jobs.
const BOARD = { employer: "Brightline Freight", slug: "brightline" };
const isBoardListRequest = (url: URL) =>
  url.host === "boards-api.greenhouse.io" && url.pathname === `/v1/boards/${BOARD.slug}/jobs`;

const run = (id: string, iso: string) => ({ id, at: new Date(iso) });
const NO_TERMS = run("run-no-search-terms", "2026-10-01T15:00:00.000Z");
const BLANK_TERMS = run("run-blank-search-terms", "2026-10-02T15:00:00.000Z");
const NO_TOWNS = run("run-no-towns", "2026-10-03T15:00:00.000Z");
const NO_LABELS = run("run-no-remote-labels", "2026-10-04T15:00:00.000Z");
const NEITHER = run("run-no-towns-or-labels", "2026-10-05T15:00:00.000Z");

interface Sent {
  runId: string;
  url: URL;
  input: Record<string, unknown> | null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Stands in for every website. Every Fantastic.jobs search finishes with no
// jobs, and the Greenhouse board lists none.
function standIn(sent: Sent[], state: { runId: string }): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body =
      url.host === APIFY_HOST && typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    sent.push({ runId: state.runId, url, input: body });

    if (isBoardListRequest(url)) return json({ jobs: [] }, 200);
    if (url.host === APIFY_HOST) return json([], 201);
    return json({ error: "not found" }, 404);
  };
}

// A browser that stays wherever it is sent. No job here needs following, so
// this only keeps the run whole if one ever reaches resolution.
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

// Every row of every table, as text. Read by table name from the database's
// own list of tables, so a table this feature adds is counted too.
async function everyRow(db: PipelineDb): Promise<string> {
  const tables = await db.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );
  const contents: Record<string, unknown> = {};
  for (const { name } of tables) {
    contents[name] = await db.$queryRawUnsafe(`SELECT * FROM "${name}" ORDER BY rowid`);
  }
  // Raw reads can hand back whole numbers as bigints, which JSON cannot hold.
  return JSON.stringify(contents, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value
  );
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

const fantasticJobs = (issues: CollectionIssue[]) =>
  issues.filter((issue) => issue.collector === COLLECTOR);

// The remote search is the one asking for the whole country.
const isRemote = (entry: Sent) =>
  Array.isArray(entry.input?.["locationSearch"]) &&
  (entry.input["locationSearch"] as unknown[]).includes("United States");

describe("What an empty list does to a job search and to Fantastic.jobs", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env["FANTASTIC_JOBS_APIFY_TOKEN"];
  const sent: Sent[] = [];
  const state = { runId: "" };
  const reports: Record<string, RunJobSearchResult> = {};
  let rowsBeforeRefusal = "";
  let rowsAfterRefusal = "";
  let dir: string;
  let db: PipelineDb;

  const report = (runId: string): RunJobSearchResult => {
    const found = reports[runId];
    if (!found) throw new Error(`no job search named ${runId} ran`);
    return found;
  };
  const sentIn = (runId: string) => sent.filter((entry) => entry.runId === runId);
  const searchesIn = (runId: string) =>
    sentIn(runId).filter((entry) => entry.url.host === APIFY_HOST);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-fantastic-jobs-empty-settings-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    await setSetting(db, TOWNS, AUSTIN_TOWNS);
    await setSetting(db, REMOTE_LABELS, LABELS);
    await setSetting(db, EXCLUDED_TITLES, []);
    await setSetting(db, WINDOW_DAYS, 7);

    const companies = createCompanyService(db);
    const atsSlugs = createAtsSlugService(db);
    const { company } = await companies.create({ name: BOARD.employer });
    await atsSlugs.record({ slug: BOARD.slug, company_id: company.id, parser: "greenhouse" });
    await atsSlugs.addCollector(BOARD.slug, "greenhouse");

    process.env["FANTASTIC_JOBS_APIFY_TOKEN"] = TOKEN;
    globalThis.fetch = standIn(sent, state);

    const names = new Set([COLLECTOR, "greenhouse"]);
    const shared = {
      settings: createSettingsService(db),
      companies,
      atsSlugs,
      jobService: createJobService(db),
      lastSuccesses: createLastSuccessService(db),
      collectors: COLLECTORS.filter((collector) => names.has(collector.name)),
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      trace: createTraceService(db),
      log: () => {},
    };
    const search = async (next: { id: string; at: Date }) => {
      state.runId = next.id;
      reports[next.id] = await runJobSearch({ ...shared, collectedAt: next.at, runId: next.id });
    };

    await db.setting.update({ where: { id: 1 }, data: { search_terms: [] } });
    rowsBeforeRefusal = await everyRow(db);
    await search(NO_TERMS);
    rowsAfterRefusal = await everyRow(db);

    await db.setting.update({ where: { id: 1 }, data: { search_terms: ["", "   "] } });
    await search(BLANK_TERMS);
    await db.setting.update({ where: { id: 1 }, data: { search_terms: SEARCH_TERMS } });

    await setSetting(db, TOWNS, []);
    await search(NO_TOWNS);
    await setSetting(db, TOWNS, AUSTIN_TOWNS);

    await setSetting(db, REMOTE_LABELS, []);
    await search(NO_LABELS);

    await setSetting(db, TOWNS, []);
    await search(NEITHER);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env["FANTASTIC_JOBS_APIFY_TOKEN"];
    else process.env["FANTASTIC_JOBS_APIFY_TOKEN"] = originalToken;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Refuses to start with no search terms", () => {
    expect(report(NO_TERMS.id).failure).not.toBeNull();
    expect(sentIn(NO_TERMS.id)).toHaveLength(0);
  });

  test("Names the empty search terms", () => {
    expect(report(NO_TERMS.id).failure?.reason).toMatch(/search[_ ]terms/i);
  });

  test("Changes nothing when refusing", () => {
    expect(rowsAfterRefusal).toBe(rowsBeforeRefusal);
  });

  test("Refuses with only blank search terms", () => {
    expect(report(BLANK_TERMS.id).failure).not.toBeNull();
    expect(sentIn(BLANK_TERMS.id)).toHaveLength(0);
  });

  test("Skips the Austin search with no towns", () => {
    const searches = searchesIn(NO_TOWNS.id);
    expect(searches).toHaveLength(1);
    expect(isRemote(searches[0] as Sent)).toBe(true);
    // The other source still ran.
    expect(sentIn(NO_TOWNS.id).some((entry) => isBoardListRequest(entry.url))).toBe(true);
  });

  test("Skips the remote search with no remote labels", () => {
    const searches = searchesIn(NO_LABELS.id);
    expect(searches).toHaveLength(1);
    expect(isRemote(searches[0] as Sent)).toBe(false);
    expect(sentIn(NO_LABELS.id).some((entry) => isBoardListRequest(entry.url))).toBe(true);
  });

  test("Reports an error when both searches are switched off", () => {
    expect(searchesIn(NEITHER.id)).toHaveLength(0);
    const lines = fantasticJobs(report(NEITHER.id).errors);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.message).toContain("Fantastic.jobs");
    expect(sentIn(NEITHER.id).some((entry) => isBoardListRequest(entry.url))).toBe(true);
  });

  test("Says nothing about a switched-off search", () => {
    const { errors, warnings } = report(NO_TOWNS.id);
    expect(fantasticJobs([...errors, ...warnings]).filter((issue) => /austin/i.test(issue.message)))
      .toHaveLength(0);
  });
});
