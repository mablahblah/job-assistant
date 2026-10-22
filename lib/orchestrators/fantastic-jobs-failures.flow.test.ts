// Flow test: How a Fantastic.jobs search that fails is reported and recovered.
//
// Job searches run one after another, each giving the stand-in service a
// different way to fail:
//
// - A search that has never worked is refused.
// - The Austin search is refused with a reply over 300 characters.
// - The Austin search is answered with a single error item.
// - Both searches are refused.
// - The remote search answers after 100 seconds.
// - The remote search never answers.
// - The remote search returns 200 jobs.
// - The token is missing.
// - The window setting holds a value the service does not offer.
// - The town list is empty while the remote search is refused.
// - A missing title word list stops the run between collecting and saving.
//
// Every run but the first starts with both searches holding a saved time. A
// polled Greenhouse board runs beside Fantastic.jobs throughout, so the test
// can see whether the other sources still ran.
//
// Real services run against a scratch database. The one thing standing in is
// every website: global fetch is swapped for a stand-in answering Apify, the
// Greenhouse board and the employers' pages, so the real collectors and the
// real Apify tool run, and nothing here reaches a paid service.
//
// Covers: Moves the time of a search that worked, Keeps the time of a search
// that failed, Stops waiting after 270 seconds, Shows the service's own reply,
// Never shows the token, Reports an error when no search worked, Reports a
// warning when one search failed, Says the saved time was kept, Says how far
// back a new search will look, Lists each failed search when none worked, Keeps
// the saved time when the jobs were not saved, Warns when a search reaches its
// cap, Gives the capped count, Moves the time of a capped search, Waits for a
// slow search, Reports no failure for a slow search, Counts a timed-out search
// as failed, Cuts a long reply, Treats a lone error item as a refusal, Keeps
// other sources running, Names the missing token, Refuses an unknown window,
// Gives one line when no search can be sent.
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
import type { CollectionIssue } from "../types/collection-issue";
import { COLLECTORS } from "../collectors/registry";
import { runJobSearch, type RunJobSearchResult } from "./job-search";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and eleven job searches run after,
// one of them carrying 200 jobs through the whole pipeline. A ceiling rather
// than a budget.
const SETUP_TIMEOUT_MS = 300_000;

type PipelineDb = ReturnType<typeof createPipelineDb>;

const COLLECTOR = "fantastic-jobs";
const REMOTE = "remote";
const AUSTIN_SEARCH = "austin";
const TOKEN = "apify_api_FailuresFlowToken5Rv1";
const TOKEN_VARIABLE = "FANTASTIC_JOBS_APIFY_TOKEN";
const APIFY_HOST = "api.apify.com";

// The Fantastic.jobs settings, by the column each is stored in. setSetting
// below writes one of them by its column name.
const TOWNS = "search_towns";
const REMOTE_LABELS = "remote_labels";
const EXCLUDED_TITLES = "excluded_titles";
const WINDOW_DAYS = "search_window_days";

const AUSTIN_TOWNS = ["Austin, Texas, United States"];

// The polled board running beside Fantastic.jobs.
const BOARD = { employer: "Brightline Freight", slug: "brightline" };
const isBoardListRequest = (url: URL) =>
  url.host === "boards-api.greenhouse.io" && url.pathname === `/v1/boards/${BOARD.slug}/jobs`;

const DAY_MS = 24 * 60 * 60 * 1000;

// A refusal longer than 300 characters, with a different sentence on each
// side of the cut, so a message holding more than the first 300 shows.
const LONG_REPLY =
  "Monthly usage hard limit exceeded. ".repeat(8) + "The rest of the reply is past the cut.";
const SHORT_REPLY = "Actor run failed: the service is temporarily unavailable.";

const run = (id: string, iso: string) => ({ id, at: new Date(iso) });
const NEVER_WORKED = run("run-never-worked", "2026-10-01T15:00:00.000Z");
const LONG_REFUSAL = run("run-long-refusal", "2026-10-02T15:00:00.000Z");
const ERROR_ITEM = run("run-error-item", "2026-10-03T15:00:00.000Z");
const BOTH_REFUSED = run("run-both-refused", "2026-10-04T15:00:00.000Z");
const SLOW = run("run-slow", "2026-10-05T15:00:00.000Z");
const NEVER_ANSWERED = run("run-never-answered", "2026-10-06T15:00:00.000Z");
const CAPPED = run("run-capped", "2026-10-07T15:00:00.000Z");
const NO_TOKEN = run("run-no-token", "2026-10-08T15:00:00.000Z");
const UNKNOWN_WINDOW = run("run-unknown-window", "2026-10-09T15:00:00.000Z");
const NO_TOWNS = run("run-no-towns", "2026-10-10T15:00:00.000Z");
const STOPPED = run("run-stopped-before-save", "2026-10-11T15:00:00.000Z");

// How the stand-in answers one search.
type Reply =
  | { kind: "jobs"; count: number }
  | { kind: "refused"; text: string }
  | { kind: "error item" }
  | { kind: "after"; seconds: number; count: number }
  | { kind: "never" };

const jobs = (count: number): Reply => ({ kind: "jobs", count });
const refused = (text: string): Reply => ({ kind: "refused", text });

interface Sent {
  runId: string;
  url: URL;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// A link only one bought job carries, so the job can be found after the run.
const jobLink = (runId: string, search: string, n: number) =>
  `https://careers.employer-${search}-${n}.example/jobs/${runId}`;

// One job as the service returns it.
function boughtJob(runId: string, search: string, n: number) {
  return {
    id: `${runId}-${search}-${n}`,
    date_posted: "2026-09-30T12:00:00",
    date_created: "2026-09-30T12:30:00",
    title: `Product Designer ${n}`,
    organization: `Employer ${search} ${n}`,
    url: jobLink(runId, search, n),
    source_type: "ats",
    source: "careersite",
    locations_derived: ["Austin, Texas, United States"],
    countries_derived: ["United States"],
    ai_work_arrangement: search === REMOTE ? "Remote Solely" : "On-site",
    ai_remote_location: search === REMOTE ? ["United States"] : null,
    description_text: "Design the product.",
  };
}

// An employer's page publishing job data that names no place, so the place
// the service gave stands and the job stays in the backlog.
function employerPage(): Response {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Product Designer",
    description: "<p>Design the product.</p>",
  };
  return new Response(
    "<!DOCTYPE html><html><head><title>Careers</title>" +
      `<script type="application/ld+json">${JSON.stringify(block)}</script>` +
      "</head><body><p>Design the product.</p></body></html>",
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

// Waits on a timer the test advances, giving up early the way a real request
// does when its signal aborts.
function afterDelay(
  ms: number,
  signal: AbortSignal | null | undefined,
  answer: () => Response
): Promise<Response> {
  return new Promise((resolvePromise, reject) => {
    const timer = ms === Infinity ? null : setTimeout(() => resolvePromise(answer()), ms);
    signal?.addEventListener("abort", () => {
      if (timer !== null) clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

// Stands in for every website. `state` says which job search is running and
// how each of its two searches is answered.
function standIn(
  sent: Sent[],
  state: { runId: string; replies: Record<string, Reply> }
): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    sent.push({ runId: state.runId, url });

    if (isBoardListRequest(url)) return json({ jobs: [] }, 200);
    if (url.host.endsWith(".example")) return employerPage();
    if (url.host !== APIFY_HOST) return json({ error: "not found" }, 404);

    if (typeof init?.body !== "string") throw new Error("an Apify request carried no JSON body");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const locations = Array.isArray(body["locationSearch"]) ? body["locationSearch"] : [];
    const search = locations.includes("United States") ? REMOTE : AUSTIN_SEARCH;
    const reply = state.replies[search] ?? jobs(0);
    const listOf = (count: number) =>
      json(
        Array.from({ length: count }, (_, n) => boughtJob(state.runId, search, n)),
        201
      );

    switch (reply.kind) {
      case "jobs":
        return listOf(reply.count);
      case "refused":
        return new Response(reply.text, {
          status: 402,
          headers: { "content-type": "text/plain" },
        });
      case "error item":
        // Measured in the paid test on 2026-10-21: a refused search came back
        // as a finished run holding this one item.
        return json(
          [
            {
              error:
                "Invalid advanced search syntax. Please check the docs or create an issue if you need help.",
            },
          ],
          201
        );
      case "after": {
        const pending = afterDelay(reply.seconds * 1000, init?.signal, () => listOf(reply.count));
        setImmediate(() => void vi.advanceTimersByTimeAsync(reply.seconds * 1000));
        return pending;
      }
      case "never": {
        const pending = afterDelay(Infinity, init?.signal, () => listOf(0));
        setImmediate(() => void vi.advanceTimersByTimeAsync(270_000));
        return pending;
      }
    }
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

// Answers every place lookup with the user's own city, so every bought job is
// close enough and no run reaches a mapping service.
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

interface Outcome {
  report: RunJobSearchResult;
  saved: { remote: Date | null; austin: Date | null };
  savedBefore: Date | null;
}

const fantasticJobs = (issues: CollectionIssue[]) =>
  issues.filter((issue) => issue.collector === COLLECTOR);
const naming = (issues: CollectionIssue[], search: RegExp) =>
  fantasticJobs(issues).filter((issue) => search.test(issue.message));
const REMOTE_LINE = /remote search/i;
const AUSTIN_LINE = /austin search/i;

describe("How a Fantastic.jobs search that fails is reported and recovered", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env[TOKEN_VARIABLE];
  const sent: Sent[] = [];
  const state: { runId: string; replies: Record<string, Reply> } = { runId: "", replies: {} };
  const outcomes: Record<string, Outcome> = {};
  let slowJobStatuses: (string | undefined)[] = [];
  let dir: string;
  let db: PipelineDb;

  const outcome = (runId: string): Outcome => {
    const found = outcomes[runId];
    if (!found) throw new Error(`no job search named ${runId} ran`);
    return found;
  };
  const sentIn = (runId: string) => sent.filter((entry) => entry.runId === runId);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-fantastic-jobs-failures-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    await db.setting.update({
      where: { id: 1 },
      data: { search_terms: ["Product Design"], expiry_threshold: 8 },
    });
    await setSetting(db, TOWNS, AUSTIN_TOWNS);
    await setSetting(db, REMOTE_LABELS, ["Remote OK", "Remote Solely"]);
    await setSetting(db, EXCLUDED_TITLES, []);
    await setSetting(db, WINDOW_DAYS, 7);

    const companies = createCompanyService(db);
    const atsSlugs = createAtsSlugService(db);
    const { company } = await companies.create({ name: BOARD.employer });
    await atsSlugs.record({ slug: BOARD.slug, company_id: company.id, parser: "greenhouse" });
    await atsSlugs.addCollector(BOARD.slug, "greenhouse");

    process.env[TOKEN_VARIABLE] = TOKEN;
    globalThis.fetch = standIn(sent, state);

    const lastSuccesses = createLastSuccessService(db);
    const names = new Set([COLLECTOR, "greenhouse"]);
    const shared = {
      settings: createSettingsService(db),
      companies,
      atsSlugs,
      jobService: createJobService(db),
      lastSuccesses,
      collectors: COLLECTORS.filter((collector) => names.has(collector.name)),
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      trace: createTraceService(db),
      log: () => {},
    };

    // Runs one job search. Every one but the first starts with both searches
    // holding the time a day before it, so a moved time and a kept one differ.
    const search = async (
      next: { id: string; at: Date },
      replies: Record<string, Reply>,
      options: { fakeTimers?: boolean; withSavedTimes?: boolean } = {}
    ) => {
      const savedBefore =
        options.withSavedTimes === false ? null : new Date(next.at.getTime() - DAY_MS);
      if (savedBefore !== null) {
        await lastSuccesses.record(COLLECTOR, REMOTE, savedBefore);
        await lastSuccesses.record(COLLECTOR, AUSTIN_SEARCH, savedBefore);
      }
      state.runId = next.id;
      state.replies = replies;
      if (options.fakeTimers) {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
      }
      try {
        const report = await runJobSearch({ ...shared, collectedAt: next.at, runId: next.id });
        outcomes[next.id] = {
          report,
          saved: {
            remote: await lastSuccesses.find(COLLECTOR, REMOTE),
            austin: await lastSuccesses.find(COLLECTOR, AUSTIN_SEARCH),
          },
          savedBefore,
        };
      } finally {
        if (options.fakeTimers) vi.useRealTimers();
      }
    };

    await search(
      NEVER_WORKED,
      { [REMOTE]: jobs(1), [AUSTIN_SEARCH]: refused(SHORT_REPLY) },
      { withSavedTimes: false }
    );
    await search(LONG_REFUSAL, { [REMOTE]: jobs(1), [AUSTIN_SEARCH]: refused(LONG_REPLY) });
    await search(ERROR_ITEM, { [REMOTE]: jobs(1), [AUSTIN_SEARCH]: { kind: "error item" } });
    await search(BOTH_REFUSED, {
      [REMOTE]: refused(SHORT_REPLY),
      [AUSTIN_SEARCH]: refused(SHORT_REPLY),
    });
    await search(
      SLOW,
      { [REMOTE]: { kind: "after", seconds: 100, count: 2 }, [AUSTIN_SEARCH]: jobs(1) },
      { fakeTimers: true }
    );
    slowJobStatuses = await Promise.all(
      [0, 1].map(async (n) => {
        const row = await db.job.findFirst({
          where: { resolved_url: jobLink(SLOW.id, REMOTE, n) },
          select: { status: true },
        });
        return row?.status;
      })
    );
    await search(
      NEVER_ANSWERED,
      { [REMOTE]: { kind: "never" }, [AUSTIN_SEARCH]: jobs(1) },
      { fakeTimers: true }
    );
    await search(CAPPED, { [REMOTE]: jobs(200), [AUSTIN_SEARCH]: jobs(0) });

    delete process.env[TOKEN_VARIABLE];
    await search(NO_TOKEN, { [REMOTE]: jobs(1), [AUSTIN_SEARCH]: jobs(1) });
    process.env[TOKEN_VARIABLE] = TOKEN;

    await setSetting(db, WINDOW_DAYS, 3);
    await search(UNKNOWN_WINDOW, { [REMOTE]: jobs(1), [AUSTIN_SEARCH]: jobs(1) });
    await setSetting(db, WINDOW_DAYS, 7);

    await setSetting(db, TOWNS, []);
    await search(NO_TOWNS, { [REMOTE]: refused(SHORT_REPLY), [AUSTIN_SEARCH]: jobs(1) });
    await setSetting(db, TOWNS, AUSTIN_TOWNS);

    // A missing title word list stops the run after collecting and before the
    // collected jobs are saved.
    const headNouns = await shared.settings.getTitleHeadNouns();
    await db.setting.update({ where: { id: 1 }, data: { title_head_nouns: [] } });
    await search(STOPPED, { [REMOTE]: jobs(1), [AUSTIN_SEARCH]: jobs(1) });
    await db.setting.update({ where: { id: 1 }, data: { title_head_nouns: headNouns } });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env[TOKEN_VARIABLE];
    else process.env[TOKEN_VARIABLE] = originalToken;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Moves the time of a search that worked", () => {
    const { saved } = outcome(LONG_REFUSAL.id);
    expect(saved.remote?.toISOString()).toBe(LONG_REFUSAL.at.toISOString());
  });

  test("Keeps the time of a search that failed", () => {
    const { saved, savedBefore } = outcome(LONG_REFUSAL.id);
    expect(saved.austin?.toISOString()).toBe(savedBefore?.toISOString());
  });

  test("Stops waiting after 270 seconds", () => {
    // The job search finished although the remote search never answered, and
    // the Austin search was still sent after it.
    const { report } = outcome(NEVER_ANSWERED.id);
    expect(report.failure).toBeNull();
    const apify = sentIn(NEVER_ANSWERED.id).filter((entry) => entry.url.host === APIFY_HOST);
    expect(apify).toHaveLength(2);
  });

  test("Shows the service's own reply", () => {
    const [line] = naming(outcome(LONG_REFUSAL.id).report.warnings, AUSTIN_LINE);
    expect(line?.message).toContain(LONG_REPLY.slice(0, 300));
  });

  test("Never shows the token", () => {
    expect(Object.keys(outcomes)).toHaveLength(11);
    for (const { report } of Object.values(outcomes)) {
      for (const issue of [...report.errors, ...report.warnings]) {
        expect(issue.message).not.toContain(TOKEN);
      }
      expect(report.failure?.reason ?? "").not.toContain(TOKEN);
    }
  });

  test("Reports an error when no search worked", () => {
    expect(fantasticJobs(outcome(BOTH_REFUSED.id).report.errors).length).toBeGreaterThan(0);
    // One search failed while the other was not sent: still none worked.
    expect(naming(outcome(NO_TOWNS.id).report.errors, REMOTE_LINE)).toHaveLength(1);
    expect(fantasticJobs(outcome(NO_TOWNS.id).report.warnings)).toHaveLength(0);
  });

  test("Reports a warning when one search failed", () => {
    const { report } = outcome(LONG_REFUSAL.id);
    expect(naming(report.warnings, AUSTIN_LINE)).toHaveLength(1);
    expect(fantasticJobs(report.errors)).toHaveLength(0);
  });

  test("Says the saved time was kept", () => {
    const [line] = naming(outcome(LONG_REFUSAL.id).report.warnings, AUSTIN_LINE);
    expect(line?.message).toMatch(/saved time was kept/i);
  });

  test("Says how far back a new search will look", () => {
    // Neither search had worked before, and the 7-day window is shorter than
    // the 8-day age limit.
    const [line] = naming(outcome(NEVER_WORKED.id).report.warnings, AUSTIN_LINE);
    expect(line?.message).toMatch(/never worked/i);
    expect(line?.message).toMatch(/7 days/);
    expect(line?.message).not.toMatch(/saved time was kept/i);
  });

  test("Lists each failed search when none worked", () => {
    const { report } = outcome(BOTH_REFUSED.id);
    expect(naming(report.errors, REMOTE_LINE)).toHaveLength(1);
    expect(naming(report.errors, AUSTIN_LINE)).toHaveLength(1);
    expect(fantasticJobs(report.warnings)).toHaveLength(0);
  });

  test("Keeps the saved time when the jobs were not saved", () => {
    const { report, saved, savedBefore } = outcome(STOPPED.id);
    expect(report.failure).not.toBeNull();
    expect(saved.remote?.toISOString()).toBe(savedBefore?.toISOString());
    expect(saved.austin?.toISOString()).toBe(savedBefore?.toISOString());
  });

  test("Warns when a search reaches its cap", () => {
    expect(naming(outcome(CAPPED.id).report.warnings, REMOTE_LINE)).toHaveLength(1);
  });

  test("Gives the capped count", () => {
    const [line] = naming(outcome(CAPPED.id).report.warnings, REMOTE_LINE);
    expect(line?.message).toMatch(/\b200\b/);
  });

  test("Moves the time of a capped search", () => {
    expect(outcome(CAPPED.id).saved.remote?.toISOString()).toBe(CAPPED.at.toISOString());
  });

  test("Waits for a slow search", () => {
    expect(slowJobStatuses).toEqual(["backlog", "backlog"]);
  });

  test("Reports no failure for a slow search", () => {
    const { report } = outcome(SLOW.id);
    expect(naming(report.errors, REMOTE_LINE)).toHaveLength(0);
    expect(naming(report.warnings, REMOTE_LINE)).toHaveLength(0);
  });

  test("Counts a timed-out search as failed", () => {
    const { report, saved, savedBefore } = outcome(NEVER_ANSWERED.id);
    expect(naming(report.warnings, REMOTE_LINE)).toHaveLength(1);
    expect(saved.remote?.toISOString()).toBe(savedBefore?.toISOString());
  });

  test("Cuts a long reply", () => {
    const [line] = naming(outcome(LONG_REFUSAL.id).report.warnings, AUSTIN_LINE);
    expect(line?.message).toContain(`${LONG_REPLY.slice(0, 300)}…`);
    expect(line?.message).not.toContain(LONG_REPLY.slice(0, 301));
  });

  test("Treats a lone error item as a refusal", () => {
    const { report, saved, savedBefore } = outcome(ERROR_ITEM.id);
    expect(naming(report.warnings, AUSTIN_LINE)).toHaveLength(1);
    expect(saved.austin?.toISOString()).toBe(savedBefore?.toISOString());
  });

  test("Keeps other sources running", () => {
    // Fantastic.jobs could send no search, and the polled board was still read.
    expect(sentIn(NO_TOKEN.id).some((entry) => isBoardListRequest(entry.url))).toBe(true);
    expect(sentIn(UNKNOWN_WINDOW.id).some((entry) => isBoardListRequest(entry.url))).toBe(true);
  });

  test("Names the missing token", () => {
    const lines = fantasticJobs(outcome(NO_TOKEN.id).report.errors);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.message).toContain(TOKEN_VARIABLE);
  });

  test("Refuses an unknown window", () => {
    const lines = fantasticJobs(outcome(UNKNOWN_WINDOW.id).report.errors);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.message).toMatch(/window/i);
    expect(lines[0]?.message).toMatch(/\b3\b/);
  });

  test("Gives one line when no search can be sent", () => {
    for (const runId of [NO_TOKEN.id, UNKNOWN_WINDOW.id]) {
      const { report } = outcome(runId);
      expect(fantasticJobs(report.errors)).toHaveLength(1);
      expect(naming(report.errors, REMOTE_LINE)).toHaveLength(0);
      expect(naming(report.errors, AUSTIN_LINE)).toHaveLength(0);
      expect(fantasticJobs(report.warnings)).toHaveLength(0);
      expect(sentIn(runId).some((entry) => entry.url.host === APIFY_HOST)).toBe(false);
    }
  });
});
