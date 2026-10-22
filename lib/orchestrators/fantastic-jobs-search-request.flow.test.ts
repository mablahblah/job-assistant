// Flow test: What each Fantastic.jobs search asks for.
//
// Four job searches run against a database holding the Fantastic.jobs settings
// and three boards: one polled for "Linda Werner & Associates", one polled for
// "Quo", and one known for an employer no collector polls. The first runs the
// starting settings with a blank search term and a title to skip, the second a
// changed town list, the third a 1-day window, and the fourth an empty list of
// titles to skip. In the first three, the first search's reply is held open,
// refused, and never answered, and each time the second search must arrive only
// after the first has finished.
//
// Real services run against a scratch database. The one thing standing in is
// Apify: global fetch is swapped for a stand-in that records every request and
// answers it, so the real collector and the real Apify tool run, and nothing
// here reaches a paid service.
//
// Covers: Sends a remote search, Sends an Austin search, Searches by the shared
// search terms, Leaves out blank search terms, Skips the titles to skip,
// Searches every listed town, Asks only for remote jobs in the remote search,
// Asks for agency removal, Leaves out every polled company, Keeps companies
// that are not polled, Uses a changed setting on the next search, Searches with
// no titles to skip, Tells the service to stop at 240 seconds, Caps each search
// at 200 jobs, Caps each search at $2.50, Uses the window setting, Runs the
// searches one at a time, Sends no title exclusions when none are listed,
// Sends the token in a header, Keeps the token out of the web address, Asks for
// remote jobs in the United States, Asks for plain-text descriptions.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
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

// Creating and seeding each spawn npx tsx, and four job searches run after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

const COLLECTOR = "fantastic-jobs";

// A token of the shape Apify issues, so a message or a web address holding it
// can be found by searching for it.
const TOKEN = "apify_api_SearchRequestFlowToken7Qm2";

// The Apify host. Every request to it is a Fantastic.jobs search, because no
// other collector runs here.
const APIFY_HOST = "api.apify.com";

// How long the first search's reply is held open in the first job search: long
// enough that a second search sent alongside it would arrive while it waits.
const HOLD_MS = 150;

// The Fantastic.jobs settings, by the column each is stored in. setSetting
// below writes one of them by its column name.
const TOWNS = "search_towns";
const REMOTE_LABELS = "remote_labels";
const EXCLUDED_TITLES = "excluded_titles";
const WINDOW_DAYS = "search_window_days";

const AUSTIN = "Austin, Texas, United States";
const ROUND_ROCK = "Round Rock, Texas, United States";
const GEORGETOWN = "Georgetown, Texas, United States";

// A blank entry sits between the two real terms.
const SEARCH_TERMS = ["Product Design", "   ", "UX"];

const POLLED_BY_GREENHOUSE = "Linda Werner & Associates";
const POLLED_BY_LEVER = "Quo";
const NOT_POLLED = "Harborview Health";

const RUNS = [
  { id: "run-starting-settings", at: new Date("2026-10-01T15:00:00.000Z") },
  { id: "run-changed-towns", at: new Date("2026-10-02T15:00:00.000Z") },
  { id: "run-one-day-window", at: new Date("2026-10-03T15:00:00.000Z") },
  { id: "run-no-titles-to-skip", at: new Date("2026-10-04T15:00:00.000Z") },
] as const;

// How the stand-in answers the first search of a job search. Every other
// search is answered at once with no jobs.
type FirstReply = "held" | "refused" | "never";

interface SentSearch {
  runId: string;
  url: URL;
  headers: Headers;
  input: Record<string, unknown>;
  // Whether another search was still waiting on its reply when this one
  // arrived.
  overlapped: boolean;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// A finished run with no jobs. Apify answers a finished synchronous run with
// 201 and the dataset's items.
const noJobs = () => json([], 201);

// Apify's answer when an account cannot pay for a run.
const refusal = () =>
  new Response("Monthly usage hard limit exceeded. Please upgrade your plan.", {
    status: 402,
    headers: { "content-type": "text/plain" },
  });

// A reply that never comes. It ends only when the request is called off, the
// way a real request does when its signal aborts.
function neverAnswered(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError"))
    );
  });
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("an Apify request carried no JSON body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

// Stands in for Apify. `state` says which job search is running and how its
// first search is answered.
function standIn(
  sent: SentSearch[],
  state: { runId: string; firstReply: FirstReply }
): typeof fetch {
  let waiting = 0;
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host !== APIFY_HOST) return json({ error: "not found" }, 404);

    const isFirst = !sent.some((search) => search.runId === state.runId);
    sent.push({
      runId: state.runId,
      url,
      headers: new Headers(init?.headers),
      input: bodyOf(init),
      overlapped: waiting > 0,
    });

    waiting += 1;
    try {
      if (!isFirst) return noJobs();
      if (state.firstReply === "refused") return refusal();
      if (state.firstReply === "never") {
        // The app's wait runs on a timer the test can advance, so the 270
        // seconds pass at once rather than in real time.
        setImmediate(() => void vi.advanceTimersByTimeAsync(270_000));
        return await neverAnswered(init?.signal);
      }
      await new Promise((done) => setTimeout(done, HOLD_MS));
      return noJobs();
    } finally {
      waiting -= 1;
    }
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

// The remote search is the one asking for the whole country.
const isRemote = (search: SentSearch) =>
  Array.isArray(search.input["locationSearch"]) &&
  (search.input["locationSearch"] as unknown[]).includes("United States");

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

describe("What each Fantastic.jobs search asks for", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env["FANTASTIC_JOBS_APIFY_TOKEN"];
  const sent: SentSearch[] = [];
  const state: { runId: string; firstReply: FirstReply } = {
    runId: "",
    firstReply: "held",
  };
  let dir: string;
  let db: PipelineDb;

  const searchesOf = (runId: string) => sent.filter((search) => search.runId === runId);
  const remoteOf = (runId: string) => searchesOf(runId).filter(isRemote);
  const austinOf = (runId: string) => searchesOf(runId).filter((search) => !isRemote(search));
  const firstRun = RUNS[0].id;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-fantastic-jobs-request-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    await db.setting.update({ where: { id: 1 }, data: { search_terms: SEARCH_TERMS } });
    await setSetting(db, TOWNS, [AUSTIN, ROUND_ROCK]);
    await setSetting(db, REMOTE_LABELS, ["Remote OK", "Remote Solely"]);
    await setSetting(db, EXCLUDED_TITLES, ["Director"]);
    await setSetting(db, WINDOW_DAYS, 7);

    const companies = createCompanyService(db);
    const atsSlugs = createAtsSlugService(db);
    const boards = [
      { employer: POLLED_BY_GREENHOUSE, slug: "lindawerner", parser: "greenhouse", collector: "greenhouse" },
      { employer: POLLED_BY_LEVER, slug: "quo", parser: "lever", collector: "lever" },
      { employer: NOT_POLLED, slug: "harborview", parser: "ashby", collector: null },
    ];
    for (const board of boards) {
      const { company } = await companies.create({ name: board.employer });
      await atsSlugs.record({ slug: board.slug, company_id: company.id, parser: board.parser });
      if (board.collector) await atsSlugs.addCollector(board.slug, board.collector);
    }

    process.env["FANTASTIC_JOBS_APIFY_TOKEN"] = TOKEN;
    globalThis.fetch = standIn(sent, state);

    const shared = {
      settings: createSettingsService(db),
      companies,
      atsSlugs,
      jobService: createJobService(db),
      lastSuccesses: createLastSuccessService(db),
      collectors: COLLECTORS.filter((collector) => collector.name === COLLECTOR),
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      trace: createTraceService(db),
      log: () => {},
    };
    const search = async (run: (typeof RUNS)[number], firstReply: FirstReply) => {
      state.runId = run.id;
      state.firstReply = firstReply;
      await runJobSearch({ ...shared, collectedAt: run.at, runId: run.id });
    };

    await search(RUNS[0], "held");

    await setSetting(db, TOWNS, [GEORGETOWN]);
    await search(RUNS[1], "refused");

    await setSetting(db, WINDOW_DAYS, 1);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      await search(RUNS[2], "never");
    } finally {
      vi.useRealTimers();
    }

    await setSetting(db, WINDOW_DAYS, 7);
    await setSetting(db, EXCLUDED_TITLES, []);
    await search(RUNS[3], "held");
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env["FANTASTIC_JOBS_APIFY_TOKEN"];
    else process.env["FANTASTIC_JOBS_APIFY_TOKEN"] = originalToken;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Sends a remote search", () => {
    expect(remoteOf(firstRun)).toHaveLength(1);
  });

  test("Sends an Austin search", () => {
    expect(austinOf(firstRun)).toHaveLength(1);
  });

  test("Searches by the shared search terms", () => {
    for (const search of searchesOf(firstRun)) {
      expect(search.input["titleSearch"]).toContain("Product Design:*");
      expect(search.input["titleSearch"]).toContain("UX:*");
    }
  });

  test("Leaves out blank search terms", () => {
    expect(searchesOf(firstRun)).toHaveLength(2);
    for (const search of searchesOf(firstRun)) {
      const titles = listOf(search.input["titleSearch"]).map((title) => String(title));
      expect(titles).toHaveLength(2);
      expect(titles.every((title) => title.replace(/:\*$/, "").trim() !== "")).toBe(true);
    }
  });

  test("Skips the titles to skip", () => {
    expect(searchesOf(firstRun)).toHaveLength(2);
    for (const search of searchesOf(firstRun)) {
      expect(search.input["titleExclusionSearch"]).toContain("Director:*");
    }
  });

  test("Searches every listed town", () => {
    const towns = listOf(austinOf(firstRun)[0]?.input["locationSearch"]);
    expect(towns).toEqual(expect.arrayContaining([AUSTIN, ROUND_ROCK]));
  });

  test("Asks only for remote jobs in the remote search", () => {
    const labels = listOf(remoteOf(firstRun)[0]?.input["aiWorkArrangementFilter"]);
    expect([...labels].sort()).toEqual(["Remote OK", "Remote Solely"]);
  });

  test("Asks for agency removal", () => {
    expect(sent.length).toBeGreaterThan(0);
    for (const search of sent) expect(search.input["removeAgency"]).toBe(true);
  });

  test("Leaves out every polled company", () => {
    expect(sent.length).toBeGreaterThan(0);
    for (const search of sent) {
      expect(search.input["organizationExclusionSearch"]).toEqual(
        expect.arrayContaining([POLLED_BY_GREENHOUSE, POLLED_BY_LEVER])
      );
    }
  });

  test("Keeps companies that are not polled", () => {
    expect(sent.length).toBeGreaterThan(0);
    for (const search of sent) {
      expect(listOf(search.input["organizationExclusionSearch"])).not.toContain(NOT_POLLED);
    }
  });

  test("Uses a changed setting on the next search", () => {
    // The town list changed before the second job search.
    expect(listOf(austinOf(RUNS[1].id)[0]?.input["locationSearch"])).toEqual([GEORGETOWN]);
    // The window changed before the third.
    for (const search of searchesOf(RUNS[2].id)) expect(search.input["timeRange"]).toBe("24h");
    // The titles to skip were emptied before the fourth.
    expect(searchesOf(RUNS[3].id)).toHaveLength(2);
    for (const search of searchesOf(RUNS[3].id)) {
      expect(listOf(search.input["titleExclusionSearch"])).toHaveLength(0);
    }
  });

  test("Searches with no titles to skip", () => {
    expect(remoteOf(RUNS[3].id)).toHaveLength(1);
    expect(austinOf(RUNS[3].id)).toHaveLength(1);
  });

  test("Tells the service to stop at 240 seconds", () => {
    expect(sent.length).toBeGreaterThan(0);
    for (const search of sent) expect(search.url.searchParams.get("timeout")).toBe("240");
  });

  test("Caps each search at 200 jobs", () => {
    // No run here sets a job limit, so every search asks for the cap itself.
    expect(sent.length).toBeGreaterThan(0);
    for (const search of sent) expect(search.input["limit"]).toBe(200);
  });

  test("Caps each search at $2.50", () => {
    expect(sent.length).toBeGreaterThan(0);
    for (const search of sent) {
      expect(Number(search.url.searchParams.get("maxTotalChargeUsd"))).toBe(2.5);
    }
  });

  test("Uses the window setting", () => {
    expect(searchesOf(firstRun)).toHaveLength(2);
    for (const search of searchesOf(firstRun)) expect(search.input["timeRange"]).toBe("7d");
    expect(searchesOf(RUNS[2].id)).toHaveLength(2);
    for (const search of searchesOf(RUNS[2].id)) expect(search.input["timeRange"]).toBe("24h");
  });

  test("Runs the searches one at a time", () => {
    // The first search was held open, refused, and never answered in turn.
    for (const run of RUNS.slice(0, 3)) {
      const searches = searchesOf(run.id);
      expect(searches).toHaveLength(2);
      expect(searches.map((search) => search.overlapped)).toEqual([false, false]);
    }
  });

  test("Sends no title exclusions when none are listed", () => {
    expect(searchesOf(RUNS[3].id)).toHaveLength(2);
    for (const search of searchesOf(RUNS[3].id)) {
      expect(listOf(search.input["titleExclusionSearch"])).toHaveLength(0);
    }
  });

  test("Sends the token in a header", () => {
    expect(sent.length).toBeGreaterThan(0);
    for (const search of sent) expect(search.headers.get("authorization")).toContain(TOKEN);
  });

  test("Keeps the token out of the web address", () => {
    expect(sent.length).toBeGreaterThan(0);
    for (const search of sent) expect(search.url.toString()).not.toContain(TOKEN);
  });

  test("Asks for remote jobs in the United States", () => {
    expect(listOf(remoteOf(firstRun)[0]?.input["locationSearch"])).toEqual(["United States"]);
  });

  test("Asks for plain-text descriptions", () => {
    expect(sent.length).toBeGreaterThan(0);
    for (const search of sent) expect(search.input["descriptionType"]).toBe("text");
  });
});
