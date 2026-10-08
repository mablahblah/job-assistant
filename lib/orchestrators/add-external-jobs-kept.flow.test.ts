// Flow test: Jobs the pipeline could not judge are let through.
//
// Four links are added:
//
// - One whose site refuses the visit when its link is followed.
// - One whose posting refuses to be read, so no parser reads a place off it.
// - One whose posting names no place and no remote work.
// - One whose posting names a place the mapping service cannot find.
//
// The add-external-jobs runner adds them, then scoring gathers its work. The
// test checks each job's status, the records naming why each was let
// through, that the location check recorded nothing for the three page
// reading let through, each job's printed line, and that scoring gathered
// all four.
//
// Real services run against a scratch database. The website and the browser
// that follows links are local stand-ins, and every place is answered by a
// stand-in, so nothing here reaches a real website or a mapping service.
//
// Covers: A link that cannot be followed is kept, A page that cannot be read
// is kept, A place that cannot be found is kept, A kept job is ready for
// scoring, A kept job carries no note, The run records why a job was let
// through, A job let through skips the location check, A let-through job's
// line gives every reason.
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
import { addedJobsReport } from "../utils/added-jobs-report";
import { runAddExternalJobs, type RunAddExternalJobsResult } from "./add-external-jobs";
import { runScoringGather } from "./scoring";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and the run and the gather follow.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const RUN_ID = "run-add-kept";

// The event the run records when it lets an added job through, and the
// words its printed line carries.
const LET_THROUGH_EVENT = "job_let_through";
const LET_THROUGH_WORDS = "could not be judged for certain";

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Each posting carries the reason page reading or the location check gives
// for it, which is the reason the run lets it through.
const UNFOLLOWABLE = {
  hostAndPath: "careers.dunmore.example/jobs/12",
  title: "Product Designer",
  employer: "Dunmore",
  letThroughReason: "no_location",
};
const UNREADABLE = {
  hostAndPath: "jobs.tallpine.example/openings/7",
  title: "UX Researcher",
  employer: "Tallpine",
  letThroughReason: "no_location",
};
const NOWHERE = {
  hostAndPath: "careers.redcliff.example/roles/3",
  title: "Visual Designer",
  employer: "Redcliff",
  letThroughReason: "no_location",
};
const UNPLACEABLE = {
  hostAndPath: "careers.kestrel.example/jobs/55",
  title: "Interaction Designer",
  employer: "Kestrel",
  letThroughReason: "location_unusable",
};
const KEPT = [UNFOLLOWABLE, UNREADABLE, NOWHERE, UNPLACEABLE];

// The jobs page reading found no place for. The location check never sees
// them.
const NO_PLACE_FOUND = [UNFOLLOWABLE, UNREADABLE, NOWHERE];

// The one place no map can find. Every other place answers as home.
const UNMAPPED_PLACE = "Atlantis Springs";

// A posting's job data. A posting given no place names none anywhere on its
// page, and says nothing about working remotely.
function postingPage(locality?: string): string {
  const block: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "A role",
    datePosted: "2026-08-30",
    description: "<p>The page's own description of this role.</p>",
  };
  if (locality !== undefined) {
    block["jobLocation"] = {
      "@type": "Place",
      // A city alone, so the one place the posting names is the one the map
      // is asked about.
      address: { "@type": "PostalAddress", addressLocality: locality },
    };
  }
  return (
    "<!DOCTYPE html><html><head><title>Careers</title>" +
    `<script type="application/ld+json">${JSON.stringify(block)}</script>` +
    "</head><body><p>The page's own description of this role.</p></body></html>"
  );
}

// What the browser that follows links finds. The refusing site turns away
// every visit, so the second try the pipeline gives a refused site is turned
// away too. The other three are postings it lands on.
const followedPages: SitePages = {
  [UNFOLLOWABLE.hostAndPath]: { status: 403, body: "<html><body>Access denied</body></html>" },
  [UNREADABLE.hostAndPath]: { body: "<p>UX Researcher at Tallpine</p>" },
  [NOWHERE.hostAndPath]: { body: "<p>Visual Designer at Redcliff</p>" },
  [UNPLACEABLE.hostAndPath]: { body: "<p>Interaction Designer at Kestrel</p>" },
};

// What a parser finds when it reads each posting.
const sites = fakePageFetcher({
  [UNFOLLOWABLE.hostAndPath]: { status: 403, body: "<html><body>Access denied</body></html>" },
  [UNREADABLE.hostAndPath]: { status: 403, body: "<html><body>Access denied</body></html>" },
  [NOWHERE.hostAndPath]: { body: postingPage() },
  [UNPLACEABLE.hostAndPath]: { body: postingPage(UNMAPPED_PLACE) },
});

const linkTo = (hostAndPath: string) => {
  const slash = hostAndPath.indexOf("/");
  return `http://${hostAndPath.slice(0, slash)}:${sites.port()}${hostAndPath.slice(slash)}`;
};

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

// Answers every place lookup with the user's own city, except the one place
// no map can find. That one falls through to the mapping stand-in, which
// answers nothing.
const places = fakePlaceService([], {
  async findByText(text: string) {
    if (text.includes(UNMAPPED_PLACE)) return null;
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

interface TraceRow {
  step: string;
  event: string;
  reason: string | null;
}

describe("Jobs the pipeline could not judge are let through", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let result: RunAddExternalJobsResult;
  let report: string[];
  let statuses: Record<string, string | undefined>;
  let records: Record<string, TraceRow[]>;
  let gatheredIds: string[];

  const jobIdFor = (posting: { hostAndPath: string }): string => {
    const link = linkTo(posting.hostAndPath);
    const jobId = result.outcomes.find((outcome) => outcome.link === link)?.jobId;
    if (!jobId) throw new Error(`no job was added for ${link}`);
    return jobId;
  };

  const lineFor = (posting: { title: string; employer: string }) =>
    report.find((line) => line.includes(posting.title) && line.includes(posting.employer));

  beforeAll(async () => {
    await sites.start();

    dir = mkdtempSync(join(tmpdir(), "pipeline-add-kept-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    globalThis.fetch = sites.fetch;

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);
    const trace = createTraceService(db);

    result = await runAddExternalJobs({
      submissions: KEPT.map((posting) => ({
        link: linkTo(posting.hostAndPath),
        title: posting.title,
        employer: posting.employer,
        description: `${posting.title} at ${posting.employer}, as the agent read it.`,
      })),
      settings,
      companies,
      atsSlugs: createAtsSlugService(db),
      jobService,
      openBrowser: fakeResolutionBrowser(followedPages),
      waitForLoad: async () => {},
      launchParsingBrowser: sites.launchBrowser,
      places,
      geocoder: fakeGeocoder(),
      collectedAt: RUN_AT,
      runId: RUN_ID,
      trace,
      log: () => {},
    });
    report = addedJobsReport(result);

    statuses = {};
    records = {};
    for (const posting of KEPT) {
      const id = jobIdFor(posting);
      const row = await db.job.findUnique({ where: { id }, select: { status: true } });
      statuses[posting.hostAndPath] = row?.status;
      records[posting.hostAndPath] = await db.trace.findMany({
        where: { run_id: RUN_ID, job_id: id },
        select: { step: true, event: true, reason: true },
        orderBy: { id: "asc" },
      });
    }

    const gathered = await runScoringGather({
      settings,
      companies,
      jobService,
      trace,
      runId: RUN_ID,
      referenceInstant: RUN_AT,
    });
    gatheredIds = gathered.jobs.map((job) => String(job.id));
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("A link that cannot be followed is kept", () => {
    expect(statuses[UNFOLLOWABLE.hostAndPath]).toBe("backlog");
    // The link was refused, not followed somewhere else.
    const followed = records[UNFOLLOWABLE.hostAndPath]?.filter((row) => row.step === "resolution");
    expect(followed?.map((row) => row.reason)).toContain("page_refused");
  });

  test("A page that cannot be read is kept", () => {
    expect(statuses[UNREADABLE.hostAndPath]).toBe("backlog");
    expect(statuses[NOWHERE.hostAndPath]).toBe("backlog");
  });

  test("A place that cannot be found is kept", () => {
    expect(statuses[UNPLACEABLE.hostAndPath]).toBe("backlog");
  });

  test("A kept job is ready for scoring", () => {
    for (const posting of KEPT) {
      expect(gatheredIds, posting.title).toContain(jobIdFor(posting));
    }
  });

  test("The run records why a job was let through", () => {
    for (const posting of KEPT) {
      const letThrough = records[posting.hostAndPath]?.filter((row) => row.event === LET_THROUGH_EVENT);
      expect(letThrough?.map((row) => row.reason), posting.title).toEqual([posting.letThroughReason]);
    }
  });

  test("A job let through skips the location check", () => {
    for (const posting of NO_PLACE_FOUND) {
      const checked = records[posting.hostAndPath]?.filter((row) => row.step === "classification");
      expect(checked, posting.title).toEqual([]);
    }
  });

  test("A let-through job's line gives every reason", () => {
    for (const posting of KEPT) {
      const line = lineFor(posting);
      expect(line, posting.title).toContain(LET_THROUGH_WORDS);

      // Every reason the run recorded against this job that held it back:
      // why its link could not be followed, and why it was let through.
      const reasons = (records[posting.hostAndPath] ?? [])
        .filter((row) => row.event === LET_THROUGH_EVENT || row.event === "resolution_failed")
        .map((row) => row.reason);
      expect(reasons.length, posting.title).toBeGreaterThan(0);
      for (const reason of reasons) {
        expect(line, `${posting.title}: ${String(reason)}`).toContain(String(reason));
      }
    }
  });
});
