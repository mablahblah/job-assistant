// Flow test: Duplicate matching tells UltiPro jobs apart.
//
// A seeded database, and one job search whose collector hands back four
// links. Two are different UltiPro jobs on one board, whose links differ only
// in the job's identifier. Two are one employer posting, whose links differ
// only in a tracking value. Then the list of identifying query values in the
// settings changes, and a second job search runs. The test checks what was
// stored, what the seed put in that list, and that a key already stored stays
// as it was when the list changes.
//
// Measured 2026-09-21: two different jobs on one UltiPro board produced the
// same matching key, because UltiPro carries a job's only identity in the
// query string and matching drops it. The same day, 150 of 413 stored jobs
// carried tracking values that change between runs.
//
// The setting is read and written with plain SQL rather than through the
// settings service, so this test names only the column the feature adds.
//
// Covers: Links differing in an identifying value stay separate, Links
// differing in any other query value are one job, UltiPro's job identifier is
// named as identifying, Stored matching keys are not rebuilt.
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
import type { Collector } from "../collectors/collector";
import type { JobListEntry } from "../types/job-list-entry";
import { runJobSearch, type RunJobSearchOptions } from "./job-search";
import { createLastSuccessService } from "../services/last-success-service";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and a job search runs after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

const FIRST_RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const SECOND_RUN_AT = new Date("2026-09-02T10:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

const BOARD = "https://recruiting.ultipro.com/acm1000acme/jobboard/5b3c4d2e-7f10-4a2b-9c3d-4e5f6a7b8c9d";

// Two different jobs on one UltiPro board. Their links are the same but for
// the job's identifier, written the way stored UltiPro links write it.
const ULTIPRO_FIRST =
  `${BOARD}/opportunitydetail?opportunityid=0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0&utm_source=adzuna`;
const ULTIPRO_SECOND =
  `${BOARD}/opportunitydetail?opportunityid=9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d&utm_source=adzuna`;

// One posting on the employer's own website, reached by two links that differ
// only in a tracking value.
const TRACKED_FIRST = "https://careers.acmehealth.example/jobs/42?utm_source=adzuna";
const TRACKED_SECOND = "https://careers.acmehealth.example/jobs/42?utm_source=jsearch";

function job(link: string, title: string): JobListEntry {
  return {
    original_url: link,
    resolved_url: link,
    raw_title: title,
    raw_company_name: "Acme Health",
    posting_date: new Date("2026-08-28T00:00:00.000Z"),
    posting_updated_date: new Date("2026-08-28T00:00:00.000Z"),
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

// A collector handing back fixed jobs and reaching no website. It carries the
// name of a collector the seeded ranking list knows, so saving ranks it.
function collectorOf(jobs: JobListEntry[]): Collector {
  return {
    name: "adzuna",
    async collect() {
      return { jobs, errors: [], warnings: [] };
    },
  };
}

// Nothing a parser asks for exists, so every read after collection fails
// quietly. Reading postings is not what this test is about.
const nothingFound: typeof fetch = async () =>
  new Response(JSON.stringify({ error: "not found" }), { status: 404 });

// A browser that stays wherever it is sent. The jobs arrive already followed
// to their posting, so nothing here needs a real one; this only keeps the run
// whole if a job ever reaches resolution.
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

interface StoredKeys {
  id: string;
  original_url_match_key: string | null;
  resolved_url_match_key: string | null;
}

describe("Duplicate matching tells UltiPro jobs apart", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let shared: Omit<RunJobSearchOptions, "collectors" | "collectedAt" | "runId">;
  let storedLinks: string[];

  // The employer-website posting has no reader, so it is set aside and no
  // later run saves it again. Saving a job writes its key afresh from its link,
  // so a job a run does save takes the list as it then stands; the criterion
  // is that nothing goes back over the keys already stored.
  const untouchedKeys = (): Promise<StoredKeys[]> =>
    db.job.findMany({
      where: { original_url: { startsWith: "https://careers.acmehealth.example/" } },
      select: { id: true, original_url_match_key: true, resolved_url_match_key: true },
    });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-ultipro-dedupe-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    globalThis.fetch = nothingFound;

    shared = {
      settings: createSettingsService(db),
      companies: createCompanyService(db),
      lastSuccesses: createLastSuccessService(db),
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      trace: createTraceService(db),
      log: () => {},
    };

    await runJobSearch({
      ...shared,
      collectors: [
        collectorOf([
          job(ULTIPRO_FIRST, "Product Designer"),
          job(ULTIPRO_SECOND, "Product Designer"),
          job(TRACKED_FIRST, "Content Designer"),
          job(TRACKED_SECOND, "Content Designer"),
        ]),
      ],
      collectedAt: FIRST_RUN_AT,
      runId: "run-dedupe",
    });

    const rows = await db.job.findMany({ select: { original_url: true } });
    storedLinks = rows.map((row) => row.original_url ?? "");
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Links differing in an identifying value stay separate", () => {
    expect(storedLinks.filter((link) => link.startsWith(BOARD))).toHaveLength(2);
  });

  test("Links differing in any other query value are one job", () => {
    expect(
      storedLinks.filter((link) => link.startsWith("https://careers.acmehealth.example/"))
    ).toHaveLength(1);
  });

  test("UltiPro's job identifier is named as identifying", async () => {
    const rows = await db.$queryRawUnsafe<{ identifying_query_values: unknown }[]>(
      "SELECT identifying_query_values FROM Setting WHERE id = 1"
    );
    // A Json column can come back as its text or already read, depending on
    // the driver, so both are accepted.
    const stored = rows[0]?.identifying_query_values ?? null;
    const list: unknown = typeof stored === "string" ? JSON.parse(stored) : stored;
    expect(list).toContain("opportunityid");
  });

  test(
    "Stored matching keys are not rebuilt",
    async () => {
      const before = await untouchedKeys();
      expect(before).toHaveLength(1);

      // A tracking value is now named as identifying too. Were stored keys
      // rebuilt from the new list, the tracked posting's key would change.
      await db.$executeRawUnsafe(
        "UPDATE Setting SET identifying_query_values = ? WHERE id = 1",
        JSON.stringify(["opportunityid", "utm_source"])
      );
      await runJobSearch({
        ...shared,
        collectors: [collectorOf([])],
        collectedAt: SECOND_RUN_AT,
        runId: "run-after-settings",
      });

      expect(await untouchedKeys()).toEqual(before);
    },
    SETUP_TIMEOUT_MS
  );
});
