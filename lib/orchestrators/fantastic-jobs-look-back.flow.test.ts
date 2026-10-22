// Flow test: How far back each Fantastic.jobs search looks.
//
// Job searches run one after another on a fixed clock, with the window at 7
// days and the age limit at 8: a first search, one a day later, one after a gap
// longer than the window, one whose last success sits inside the window while
// 24 hours before it does not, one where the Austin search is refused, the one
// after it, one with the age limit set below the window, and one with a 1-day
// window. Then two runs with job limits of 10 and 3. The machine is set to US
// Central time throughout.
//
// Real services run against a scratch database. The one thing standing in is
// Apify: global fetch is swapped for a stand-in that records every request and
// answers it, so the real collector and the real Apify tool run, and nothing
// here reaches a paid service.
//
// Covers: Looks back 24 hours before the last success, Never looks back past
// the age limit, Starts from the age limit the first time, Sends a test limit
// to the service, Keeps the saved times on a limited run, Keeps only the limit,
// Never asks below the service's minimum, Asks again for what a failed search
// missed, Sends the start date in UTC.

// The machine runs on US Central time, so a start date written in local time
// rather than UTC is five hours off and shows. Set before any date is read.
process.env["TZ"] = "America/Chicago";

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

// Creating and seeding each spawn npx tsx, and ten job searches run after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 240_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

const COLLECTOR = "fantastic-jobs";
const REMOTE = "remote";
const AUSTIN_SEARCH = "austin";
const TOKEN = "apify_api_LookBackFlowToken3Kd8";
const APIFY_HOST = "api.apify.com";

// The Fantastic.jobs settings, by the column each is stored in. setSetting
// below writes one of them by its column name.
const TOWNS = "search_towns";
const REMOTE_LABELS = "remote_labels";
const EXCLUDED_TITLES = "excluded_titles";
const WINDOW_DAYS = "search_window_days";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const at = (iso: string) => new Date(iso);

// Each job search, in the order it runs.
const FIRST = { id: "run-first", at: at("2026-10-01T15:00:00.000Z") };
const NEXT_DAY = { id: "run-next-day", at: at("2026-10-02T15:00:00.000Z") };
// Ten days on, longer than the 7-day window.
const AFTER_GAP = { id: "run-after-gap", at: at("2026-10-12T15:00:00.000Z") };
// Six and a half days on: the last success is inside the window, and 24 hours
// before it is not.
const NEAR_EDGE = { id: "run-near-edge", at: at("2026-10-19T03:00:00.000Z") };
const AUSTIN_REFUSED = { id: "run-austin-refused", at: at("2026-10-20T03:00:00.000Z") };
const AFTER_REFUSAL = { id: "run-after-refusal", at: at("2026-10-21T03:00:00.000Z") };
// Nine days on, with the age limit lowered to 3 days, below the window.
const SHORT_AGE_LIMIT = { id: "run-short-age-limit", at: at("2026-10-30T03:00:00.000Z") };
// One day on, with the window set to 1 day.
const ONE_DAY_WINDOW = { id: "run-one-day-window", at: at("2026-10-31T03:00:00.000Z") };
const LIMIT_TEN = { id: "run-limit-ten", at: at("2026-11-01T03:00:00.000Z") };
const LIMIT_THREE = { id: "run-limit-three", at: at("2026-11-02T03:00:00.000Z") };

// How many jobs the stand-in returns to each search on the limited runs, more
// than either limit.
const JOBS_PER_LIMITED_SEARCH = 10;

interface SentSearch {
  runId: string;
  search: string;
  input: Record<string, unknown>;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// One job as the service returns it.
function boughtJob(runId: string, search: string, n: number) {
  return {
    id: `${runId}-${search}-${n}`,
    date_posted: "2026-10-31T12:00:00",
    date_created: "2026-10-31T12:30:00",
    title: `Product Designer ${search} ${n}`,
    organization: `Employer ${runId} ${search} ${n}`,
    url: `https://careers.employer-${n}.example/jobs/${runId}-${search}`,
    source_type: "ats",
    source: "careersite",
    locations_derived: ["Austin, Texas, United States"],
    countries_derived: ["United States"],
    ai_work_arrangement: search === REMOTE ? "Remote Solely" : "On-site",
    ai_remote_location: search === REMOTE ? ["United States"] : null,
    description_text: "Design the product.",
  };
}

// Stands in for Apify. `state` says which job search is running, whether its
// Austin search is refused, and how many jobs each search returns.
function standIn(
  sent: SentSearch[],
  state: { runId: string; austinRefused: boolean; jobsPerSearch: number }
): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host !== APIFY_HOST) return json({ error: "not found" }, 404);
    if (typeof init?.body !== "string") throw new Error("an Apify request carried no JSON body");

    const body = JSON.parse(init.body) as Record<string, unknown>;
    const locations = Array.isArray(body["locationSearch"]) ? body["locationSearch"] : [];
    const search = locations.includes("United States") ? REMOTE : AUSTIN_SEARCH;
    sent.push({ runId: state.runId, search, input: body });

    if (search === AUSTIN_SEARCH && state.austinRefused) {
      return new Response("Actor run failed: the service is temporarily unavailable.", {
        status: 503,
        headers: { "content-type": "text/plain" },
      });
    }
    const jobs = Array.from({ length: state.jobsPerSearch }, (_, n) =>
      boughtJob(state.runId, search, n)
    );
    return json(jobs, 201);
  };
}

// A browser that stays wherever it is sent. Every bought job arrives already
// at its posting, so this only keeps the run whole if one reaches resolution.
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

// The start date as UTC, to the second, however the service's own spelling of
// it ends: the trial sent "2026-09-21T21:00:00", with no zone and no
// fraction.
function utcToTheSecond(date: Date): string {
  return date.toISOString().slice(0, 19);
}

function sentStart(value: unknown): string {
  return String(value).replace(/(\.\d+)?Z?$/, "");
}

describe("How far back each Fantastic.jobs search looks", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env["FANTASTIC_JOBS_APIFY_TOKEN"];
  const sent: SentSearch[] = [];
  const state = { runId: "", austinRefused: false, jobsPerSearch: 0 };
  // Each search's saved time after each job search, keyed by run id.
  const savedAfter: Record<string, { remote: Date | null; austin: Date | null }> = {};
  let collectedOnLimitThree = 0;
  let dir: string;
  let db: PipelineDb;

  const sentBy = (runId: string, search: string) =>
    sent.filter((entry) => entry.runId === runId && entry.search === search);
  const startOf = (runId: string, search: string) =>
    sentStart(sentBy(runId, search)[0]?.input["datePostedAfter"]);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-fantastic-jobs-look-back-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    await db.setting.update({
      where: { id: 1 },
      data: { search_terms: ["Product Design"], expiry_threshold: 8 },
    });
    await setSetting(db, TOWNS, ["Austin, Texas, United States"]);
    await setSetting(db, REMOTE_LABELS, ["Remote OK", "Remote Solely"]);
    await setSetting(db, EXCLUDED_TITLES, []);
    await setSetting(db, WINDOW_DAYS, 7);

    process.env["FANTASTIC_JOBS_APIFY_TOKEN"] = TOKEN;
    globalThis.fetch = standIn(sent, state);

    const lastSuccesses = createLastSuccessService(db);
    const trace = createTraceService(db);
    const shared = {
      settings: createSettingsService(db),
      companies: createCompanyService(db),
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      lastSuccesses,
      collectors: COLLECTORS.filter((collector) => collector.name === COLLECTOR),
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      // Every page here answers a plain request, so no parser needs a browser,
      // and none may open one on the real web.
      launchParsingBrowser: async () => {
        throw new Error("this test opens no parsing browser");
      },
      places,
      geocoder: fakeGeocoder(),
      trace,
      log: () => {},
    };

    const search = async (
      run: { id: string; at: Date },
      options: { austinRefused?: boolean; jobsPerSearch?: number; limit?: number } = {}
    ) => {
      state.runId = run.id;
      state.austinRefused = options.austinRefused ?? false;
      state.jobsPerSearch = options.jobsPerSearch ?? 0;
      await runJobSearch({
        ...shared,
        collectedAt: run.at,
        runId: run.id,
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      });
      savedAfter[run.id] = {
        remote: await lastSuccesses.find(COLLECTOR, REMOTE),
        austin: await lastSuccesses.find(COLLECTOR, AUSTIN_SEARCH),
      };
    };

    await search(FIRST);
    await search(NEXT_DAY);
    await search(AFTER_GAP);
    await search(NEAR_EDGE);
    await search(AUSTIN_REFUSED, { austinRefused: true });
    await search(AFTER_REFUSAL);

    await db.setting.update({ where: { id: 1 }, data: { expiry_threshold: 3 } });
    await search(SHORT_AGE_LIMIT);
    await db.setting.update({ where: { id: 1 }, data: { expiry_threshold: 8 } });

    await setSetting(db, WINDOW_DAYS, 1);
    await search(ONE_DAY_WINDOW);
    await setSetting(db, WINDOW_DAYS, 7);

    await search(LIMIT_TEN, { jobsPerSearch: JOBS_PER_LIMITED_SEARCH, limit: 10 });
    await search(LIMIT_THREE, { jobsPerSearch: JOBS_PER_LIMITED_SEARCH, limit: 3 });
    collectedOnLimitThree = await db.trace.count({
      where: {
        run_id: LIMIT_THREE.id,
        step: "collection",
        event: "job_collected",
        collector: COLLECTOR,
      },
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env["FANTASTIC_JOBS_APIFY_TOKEN"];
    else process.env["FANTASTIC_JOBS_APIFY_TOKEN"] = originalToken;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Starts from the age limit the first time", () => {
    // Neither search has worked before, and the 7-day window is shorter than
    // the 8-day age limit.
    const expected = utcToTheSecond(new Date(FIRST.at.getTime() - 7 * DAY_MS));
    expect(startOf(FIRST.id, REMOTE)).toBe(expected);
    expect(startOf(FIRST.id, AUSTIN_SEARCH)).toBe(expected);
  });

  test("Looks back 24 hours before the last success", () => {
    const fromFirst = utcToTheSecond(new Date(FIRST.at.getTime() - DAY_MS));
    expect(startOf(NEXT_DAY.id, REMOTE)).toBe(fromFirst);
    expect(startOf(NEXT_DAY.id, AUSTIN_SEARCH)).toBe(fromFirst);
    // The remote search worked in the job search before, so it looks back from
    // that one.
    expect(startOf(AFTER_REFUSAL.id, REMOTE)).toBe(
      utcToTheSecond(new Date(AUSTIN_REFUSED.at.getTime() - DAY_MS))
    );
  });

  test("Never looks back past the age limit", () => {
    // Past the window after a long gap.
    const windowAfterGap = utcToTheSecond(new Date(AFTER_GAP.at.getTime() - 7 * DAY_MS));
    expect(startOf(AFTER_GAP.id, REMOTE)).toBe(windowAfterGap);
    expect(startOf(AFTER_GAP.id, AUSTIN_SEARCH)).toBe(windowAfterGap);
    // Past the window by only the 24 hours before the last success.
    const windowNearEdge = utcToTheSecond(new Date(NEAR_EDGE.at.getTime() - 7 * DAY_MS));
    expect(startOf(NEAR_EDGE.id, REMOTE)).toBe(windowNearEdge);
    expect(startOf(NEAR_EDGE.id, AUSTIN_SEARCH)).toBe(windowNearEdge);
    // Past the age limit, once it is the shorter of the two.
    const ageLimit = utcToTheSecond(new Date(SHORT_AGE_LIMIT.at.getTime() - 3 * DAY_MS));
    expect(startOf(SHORT_AGE_LIMIT.id, REMOTE)).toBe(ageLimit);
    expect(startOf(SHORT_AGE_LIMIT.id, AUSTIN_SEARCH)).toBe(ageLimit);
    // Past a 1-day window, which always ends 24 hours before now.
    const oneDay = utcToTheSecond(new Date(ONE_DAY_WINDOW.at.getTime() - DAY_MS));
    expect(startOf(ONE_DAY_WINDOW.id, REMOTE)).toBe(oneDay);
    expect(startOf(ONE_DAY_WINDOW.id, AUSTIN_SEARCH)).toBe(oneDay);
  });

  test("Asks again for what a failed search missed", () => {
    // The refused Austin search kept the time it last worked.
    expect(savedAfter[AUSTIN_REFUSED.id]?.austin?.toISOString()).toBe(NEAR_EDGE.at.toISOString());
    expect(startOf(AFTER_REFUSAL.id, AUSTIN_SEARCH)).toBe(
      utcToTheSecond(new Date(NEAR_EDGE.at.getTime() - DAY_MS))
    );
  });

  test("Sends the start date in UTC", () => {
    // On a Central machine, local time would read five hours earlier.
    expect(String(sentBy(FIRST.id, REMOTE)[0]?.input["datePostedAfter"])).toMatch(
      /^2026-09-24T15:00:00(\.0+)?Z?$/
    );
  });

  test("Sends a test limit to the service", () => {
    expect(sentBy(LIMIT_TEN.id, REMOTE)[0]?.input["limit"]).toBe(10);
    expect(sentBy(LIMIT_TEN.id, AUSTIN_SEARCH)[0]?.input["limit"]).toBe(10);
  });

  test("Keeps the saved times on a limited run", () => {
    const beforeLimits = ONE_DAY_WINDOW.at.toISOString();
    for (const run of [LIMIT_TEN, LIMIT_THREE]) {
      expect(sentBy(run.id, REMOTE)).toHaveLength(1);
      expect(savedAfter[run.id]?.remote?.toISOString()).toBe(beforeLimits);
      expect(savedAfter[run.id]?.austin?.toISOString()).toBe(beforeLimits);
    }
  });

  test("Keeps only the limit", () => {
    expect(collectedOnLimitThree).toBe(3);
  });

  test("Never asks below the service's minimum", () => {
    // Both searches are sent on a limited run, and each asks for the service's
    // minimum of 10 though the run keeps only 3.
    const searches = sent.filter((entry) => entry.runId === LIMIT_THREE.id);
    expect(searches).toHaveLength(2);
    for (const entry of searches) expect(entry.input["limit"]).toBe(10);
  });
});
