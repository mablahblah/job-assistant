// Flow test: Adding links to saved jobs.
//
// Seven jobs are already saved, one at each of these statuses: expired, too
// far, unresolvable, unparseable, won't apply, rejected and app. sent. An
// eighth waits in the backlog, already followed to its posting.
//
// One link is added for each of the seven, the same link the saved job holds.
// One more is added on a job board whose link, once followed, lands on the
// eighth job's posting, so the two share only that followed link.
//
// The add-external-jobs runner adds them, and the test checks each saved
// job's status and the steps this run recorded for it.
//
// Real services run against a scratch database. The website and the browser
// that follows links are local stand-ins, and every place is answered by a
// stand-in, so nothing here reaches a real website or a mapping service.
//
// Covers: A pipeline verdict is judged again, A status I set is kept, An
// application is kept, A job I ruled out or applied to goes no further, No
// other saved job's status changes, A duplicate merges as in a job search.
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
import { fakePageFetcher, type SitePages } from "../tools/page-fetcher.fake";
import { fakeResolutionBrowser } from "../tools/resolution-browser.fake";
import { saveJobs } from "../handlers/save";
import type { JobListEntry } from "../types/job-list-entry";
import { runAddExternalJobs } from "./add-external-jobs";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and the run follows. A ceiling
// rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
// Inside the seeded 8-day expiry threshold, so a job judged again is not
// expired for its age.
const SAVED_AT = new Date("2026-08-29T10:00:00.000Z");
const RUN_ID = "run-add-saved-jobs";

type PipelineDb = ReturnType<typeof createPipelineDb>;

// The statuses the pipeline gives a job, which an added link sends back
// through every step.
const PIPELINE_VERDICTS = ["expired", "too far", "unresolvable", "unparseable"];
// The statuses the user gives a job, which an added link leaves alone.
const USER_STATUSES = ["won't apply", "rejected", "app. sent"];
const SAVED_STATUSES = [...PIPELINE_VERDICTS, ...USER_STATUSES];

// The steps of the run's first stretch, up to and including its save. A job
// the user ruled out or applied to is recorded at none after it.
const FIRST_STRETCH = [
  "post_collection_normalization",
  "post_collection_association",
  "post_collection_dedupe",
  "post_collection_save",
];

// The steps a job judged again passes through after the first save.
const LATER_STEPS = ["resolution", "parsing", "classification"];

const slugOf = (status: string) => status.replace(/[^a-z]+/g, "-");
const savedIdFor = (status: string) => `saved-${slugOf(status)}`;
const hostAndPathFor = (status: string) => `careers.dunmore.example/jobs/${slugOf(status)}`;

// The waiting job, already followed from a job board to its posting, and the
// added job whose own board link lands on that same posting.
const WAITING = {
  id: "saved-waiting",
  boardHostAndPath: "board.example/listing/9",
  postingHostAndPath: "careers.tallpine.example/jobs/9",
};
const SHARES_FOLLOWED_LINK = { hostAndPath: "jobs.feedhub.example/ad/77" };

function postingPage(): string {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "A role",
    datePosted: "2026-08-29",
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: "Austin", addressRegion: "TX" },
    },
    description: "<p>The page's own description of this role.</p>",
  };
  return (
    "<!DOCTYPE html><html><head><title>Careers</title>" +
    `<script type="application/ld+json">${JSON.stringify(block)}</script>` +
    "</head><body><p>The page's own description of this role.</p></body></html>"
  );
}

const postingHostAndPaths = [...SAVED_STATUSES.map(hostAndPathFor), WAITING.postingHostAndPath];

// What a parser finds when it reads each posting.
const sites = fakePageFetcher(
  Object.fromEntries(postingHostAndPaths.map((hostAndPath) => [hostAndPath, { body: postingPage() }]))
);

const linkTo = (hostAndPath: string) => {
  const slash = hostAndPath.indexOf("/");
  return `http://${hostAndPath.slice(0, slash)}:${sites.port()}${hostAndPath.slice(slash)}`;
};

// What the browser that follows links finds. Every posting is landed on
// directly; the added board link redirects to the waiting job's posting. Built
// once the stand-in website's port is known.
function followedPages(): SitePages {
  return {
    ...Object.fromEntries(
      postingHostAndPaths.map((hostAndPath) => [hostAndPath, { body: "<p>A job posting</p>" }])
    ),
    [SHARES_FOLLOWED_LINK.hostAndPath]: { redirectTo: linkTo(WAITING.postingHostAndPath) },
  };
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

// Answers every place lookup with the user's own city, so a job judged again
// is near home and the run never reaches a mapping service.
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

describe("Adding links to saved jobs", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;

  const statusOf = async (id: string) =>
    (await db.job.findUnique({ where: { id }, select: { status: true } }))?.status;

  const stepsRecordedFor = async (id: string) => {
    const rows = await db.trace.findMany({
      where: { run_id: RUN_ID, job_id: id },
      select: { step: true },
    });
    return new Set(rows.map((row) => row.step));
  };

  beforeAll(async () => {
    await sites.start();

    dir = mkdtempSync(join(tmpdir(), "pipeline-add-saved-jobs-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);
    const { company: dunmore } = await companies.create({ name: "Dunmore" });
    const { company: tallpine } = await companies.create({ name: "Tallpine" });

    // Each saved job has been through every step already.
    const finished = {
      collector: "adzuna",
      collected_at: SAVED_AT,
      is_resolved: true,
      is_parsed: true,
      is_classified: true,
    };
    const savedJobs: JobListEntry[] = [
      ...SAVED_STATUSES.map((status) => ({
        ...finished,
        id: savedIdFor(status),
        original_url: linkTo(hostAndPathFor(status)),
        resolved_url: linkTo(hostAndPathFor(status)),
        // A title of its own, so duplicate matching never folds two together.
        raw_title: `Product Designer, ${status}`,
        title: `Product Designer, ${status}`,
        raw_company_name: "Dunmore",
        company_id: dunmore.id,
        raw_location_list: ["Austin, TX"],
        status,
      })),
      {
        ...finished,
        id: WAITING.id,
        original_url: linkTo(WAITING.boardHostAndPath),
        resolved_url: linkTo(WAITING.postingHostAndPath),
        raw_title: "UX Researcher",
        title: "UX Researcher",
        raw_company_name: "Tallpine",
        company_id: tallpine.id,
        raw_location_list: ["Austin, TX"],
        location_match: true,
        status: "backlog",
      },
    ];
    const saved = await saveJobs(savedJobs, {
      jobService,
      priorityList: await settings.getSourcePriorityList(),
      identifyingQueryValues: await settings.getIdentifyingQueryValues(),
    });
    if (saved.jobs.length !== savedJobs.length) {
      throw new Error(`the saved jobs did not save: ${JSON.stringify(saved.warnings)}`);
    }

    globalThis.fetch = sites.fetch;

    await runAddExternalJobs({
      submissions: [
        ...SAVED_STATUSES.map((status) => ({
          link: linkTo(hostAndPathFor(status)),
          title: "Product Designer",
          employer: "Dunmore",
          description: "Design the tools Dunmore's freight teams use every day.",
        })),
        {
          link: linkTo(SHARES_FOLLOWED_LINK.hostAndPath),
          title: "Research Lead",
          employer: "Feedhub",
          description: "Lead research for a booking app.",
        },
      ],
      settings,
      companies,
      atsSlugs: createAtsSlugService(db),
      jobService,
      openBrowser: fakeResolutionBrowser(followedPages()),
      waitForLoad: async () => {},
      launchParsingBrowser: sites.launchBrowser,
      places,
      geocoder: fakeGeocoder(),
      collectedAt: RUN_AT,
      runId: RUN_ID,
      trace: createTraceService(db),
      log: () => {},
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("A pipeline verdict is judged again", async () => {
    for (const status of PIPELINE_VERDICTS) {
      const steps = await stepsRecordedFor(savedIdFor(status));
      for (const step of LATER_STEPS) {
        expect(steps.has(step), `${status} at ${step}`).toBe(true);
      }
    }
  });

  test("A status I set is kept", async () => {
    expect(await statusOf(savedIdFor("won't apply"))).toBe("won't apply");
    expect(await statusOf(savedIdFor("rejected"))).toBe("rejected");
  });

  test("An application is kept", async () => {
    expect(await statusOf(savedIdFor("app. sent"))).toBe("app. sent");
  });

  test("A job I ruled out or applied to goes no further", async () => {
    for (const status of USER_STATUSES) {
      const later = [...(await stepsRecordedFor(savedIdFor(status)))].filter(
        (step) => !FIRST_STRETCH.includes(step)
      );
      expect(later, status).toEqual([]);
    }
  });

  test("No other saved job's status changes", async () => {
    expect(await statusOf(WAITING.id)).toBe("backlog");
  });

  test("A duplicate merges as in a job search", async () => {
    for (const status of SAVED_STATUSES) {
      const link = linkTo(hostAndPathFor(status));
      expect(await db.job.count({ where: { original_url: link } }), status).toBe(1);
    }
    expect(
      await db.job.count({ where: { resolved_url: linkTo(WAITING.postingHostAndPath) } })
    ).toBe(1);
  });
});
