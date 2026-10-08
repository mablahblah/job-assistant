// Flow test: Verdicts that stand.
//
// Three links are added:
//
// - One posted in a place far from home.
// - One whose page is gone.
// - One whose link leads to a page that is not found.
//
// The add-external-jobs runner adds them, and the test checks each job's
// status and the line the command prints for it.
//
// Real services run against a scratch database. The website and the browser
// that follows links are local stand-ins, and every place is answered by a
// stand-in, so nothing here reaches a real website or a mapping service.
//
// Covers: Too far stands, A dead page stands, A link that fails for good
// stands, Each job's final status is printed, A reason is
// printed for each job not in the backlog.
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

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and the run follows. A ceiling
// rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const RUN_ID = "run-add-verdicts";

type PipelineDb = ReturnType<typeof createPipelineDb>;

const FAR = {
  hostAndPath: "careers.dunmore.example/jobs/101",
  title: "Product Designer",
  employer: "Dunmore",
  status: "too far",
};
const DEAD = {
  hostAndPath: "careers.redcliff.example/roles/3",
  title: "Visual Designer",
  employer: "Redcliff",
  status: "expired",
};
const NOT_FOUND = {
  hostAndPath: "jobs.tallpine.example/openings/7",
  title: "UX Researcher",
  employer: "Tallpine",
  status: "unresolvable",
};
const POSTINGS = [FAR, DEAD, NOT_FOUND];

// The one place far from home. Every other place answers as home.
const FAR_PLACE = "Boston";

// A posting's job data.
function postingPage(options: { datePosted: string; locality: string }): string {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "A role",
    datePosted: options.datePosted,
    jobLocation: {
      "@type": "Place",
      // A city alone, so the one place the posting names is the one the map
      // is asked about.
      address: { "@type": "PostalAddress", addressLocality: options.locality },
    },
    description: "<p>Design the tools our customers use every day.</p>",
  };
  return (
    "<!DOCTYPE html><html><head><title>Careers</title>" +
    `<script type="application/ld+json">${JSON.stringify(block)}</script>` +
    "</head><body><p>Design the tools our customers use every day.</p></body></html>"
  );
}

// Every link but one is followed straight to its own posting. The one that
// fails for good answers "not found" when it is followed.
const followedPages: SitePages = {
  ...Object.fromEntries(
    POSTINGS.map((posting) => [posting.hostAndPath, { body: `<p>${posting.title}</p>` }])
  ),
  [NOT_FOUND.hostAndPath]: { status: 404, body: "<html><body>Not found</body></html>" },
};

// What a parser finds when it reads each posting. The dead one answers "not
// found".
const sites = fakePageFetcher({
  [FAR.hostAndPath]: { body: postingPage({ datePosted: "2026-08-30", locality: FAR_PLACE }) },
  [DEAD.hostAndPath]: { status: 404, body: "<html><body>Not found</body></html>" },
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
// far from home, which answers as Boston.
const places = fakePlaceService([], {
  async findByText(text: string) {
    if (text.includes(FAR_PLACE)) {
      return {
        lookup_text: text,
        latitude: 42.3601,
        longitude: -71.0589,
        place_type: "city",
        display_name: "Boston, Massachusetts",
        outline: null,
      };
    }
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

describe("Verdicts that stand", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let result: RunAddExternalJobsResult;
  let report: string[];
  let statuses: Record<string, string | undefined>;

  const outcomeFor = (posting: { hostAndPath: string }) => {
    const link = linkTo(posting.hostAndPath);
    const outcome = result.outcomes.find((candidate) => candidate.link === link);
    if (!outcome?.jobId) throw new Error(`no job was added for ${link}`);
    return outcome;
  };

  const lineFor = (posting: { title: string; employer: string }) =>
    report.find((line) => line.includes(posting.title) && line.includes(posting.employer));

  beforeAll(async () => {
    await sites.start();

    dir = mkdtempSync(join(tmpdir(), "pipeline-add-verdicts-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    globalThis.fetch = sites.fetch;

    result = await runAddExternalJobs({
      submissions: POSTINGS.map((posting) => ({
        link: linkTo(posting.hostAndPath),
        title: posting.title,
        employer: posting.employer,
        description: `${posting.title} at ${posting.employer}, as the agent read it.`,
      })),
      settings: createSettingsService(db),
      companies: createCompanyService(db),
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      openBrowser: fakeResolutionBrowser(followedPages),
      waitForLoad: async () => {},
      launchParsingBrowser: sites.launchBrowser,
      places,
      geocoder: fakeGeocoder(),
      collectedAt: RUN_AT,
      runId: RUN_ID,
      trace: createTraceService(db),
      log: () => {},
    });
    report = addedJobsReport(result);

    statuses = {};
    for (const posting of POSTINGS) {
      const row = await db.job.findUnique({
        where: { id: String(outcomeFor(posting).jobId) },
        select: { status: true },
      });
      statuses[posting.hostAndPath] = row?.status;
    }
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("Too far stands", () => {
    expect(statuses[FAR.hostAndPath]).toBe("too far");
  });

  test("A dead page stands", () => {
    expect(statuses[DEAD.hostAndPath]).toBe("expired");
  });

  test("A link that fails for good stands", () => {
    expect(statuses[NOT_FOUND.hostAndPath]).toBe("unresolvable");
  });

  test("Each job's final status is printed", () => {
    for (const posting of POSTINGS) {
      expect(outcomeFor(posting).status, posting.title).toBe(posting.status);
      expect(lineFor(posting), posting.title).toContain(posting.status);
    }
  });

  test("A reason is printed for each job not in the backlog", () => {
    for (const posting of POSTINGS) {
      const reason = outcomeFor(posting).reason;
      expect(reason, posting.title).toBeTruthy();
      expect(lineFor(posting), posting.title).toContain(String(reason));
    }
  });
});
