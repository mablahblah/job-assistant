// Flow test: Adding a list of links.
//
// Six links are added in one go:
//
// - Two to different postings near home, each with a title, an employer and
//   a description.
// - One with no title and no employer.
// - One that is not a web address.
// - Two that are the same posting, the second carrying a tracking value.
//
// The add-external-jobs runner adds them, and the test checks the jobs saved,
// the warnings, and the lines the command prints for the run.
//
// Real services run against a scratch database. The website and the browser
// that follows links are local stand-ins, and every place is answered by a
// stand-in, so nothing here reaches a real website or a mapping service.
//
// The first line the command prints, its run identifier, is the command's own
// and is checked by the command's test, the way the job search command's is.
//
// Covers: One link is added, Each link in a list is added, A link that is not
// a web address is not saved, A refused link is named in a warning, One
// failing link costs only itself, A duplicate merges as in a job search, A job
// with no title or employer still travels, No run summary, Warnings are
// printed, Each job's final status is printed.
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
import { summaryFromTraceCounts } from "../utils/run-summary";
import {
  runAddExternalJobs,
  type ExternalJobSubmission,
  type RunAddExternalJobsResult,
} from "./add-external-jobs";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and the run follows. A ceiling
// rather than a budget.
const SETUP_TIMEOUT_MS = 180_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const RUN_ID = "run-add-list";

type PipelineDb = ReturnType<typeof createPipelineDb>;

const NEAR_ONE = {
  hostAndPath: "careers.dunmore.example/jobs/101",
  title: "Product Designer",
  employer: "Dunmore",
  description: "Design the tools Dunmore's freight teams use every day.",
};
const NEAR_TWO = {
  hostAndPath: "jobs.tallpine.example/openings/7",
  title: "UX Researcher",
  employer: "Tallpine",
  description: "Run the research behind Tallpine's booking app.",
};
const BLANK = { hostAndPath: "careers.redcliff.example/roles/3" };
const SAME_POSTING = {
  hostAndPath: "careers.kestrel.example/jobs/55",
  title: "Interaction Designer",
  employer: "Kestrel",
  description: "Shape how Kestrel's customers track their orders.",
};
const TRACKING = "?utm_source=newsletter";
const NOT_A_WEB_ADDRESS = "the posting Sam sent me";

// Each posting's own page publishes job data naming a place near home, and a
// description of its own, so what the agent handed over is what has to stand.
function postingPage(): string {
  const block = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "A role",
    datePosted: "2026-08-30",
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

const pages: SitePages = Object.fromEntries(
  [
    NEAR_ONE.hostAndPath,
    NEAR_TWO.hostAndPath,
    BLANK.hostAndPath,
    SAME_POSTING.hostAndPath,
    `${SAME_POSTING.hostAndPath}${TRACKING}`,
  ].map((hostAndPath) => [hostAndPath, { body: postingPage() }])
);
const sites = fakePageFetcher(pages);

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

// Answers every place lookup with the user's own city, so every posting here
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

describe("Adding a list of links", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  let result: RunAddExternalJobsResult;
  let report: string[];
  let summaryHeadings: string[];

  const outcomeFor = (link: string) => {
    const found = result.outcomes.filter((outcome) => outcome.link === link);
    if (found.length !== 1) throw new Error(`expected one outcome for ${link}, found ${found.length}`);
    return found[0];
  };

  const jobFor = async (link: string) => {
    const jobId = outcomeFor(link).jobId;
    if (jobId === null) return null;
    return db.job.findUnique({ where: { id: jobId }, include: { company: true } });
  };

  beforeAll(async () => {
    await sites.start();

    dir = mkdtempSync(join(tmpdir(), "pipeline-add-list-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const submissions: ExternalJobSubmission[] = [
      {
        link: linkTo(NEAR_ONE.hostAndPath),
        title: NEAR_ONE.title,
        employer: NEAR_ONE.employer,
        description: NEAR_ONE.description,
      },
      {
        link: linkTo(NEAR_TWO.hostAndPath),
        title: NEAR_TWO.title,
        employer: NEAR_TWO.employer,
        description: NEAR_TWO.description,
      },
      { link: linkTo(BLANK.hostAndPath) },
      { link: NOT_A_WEB_ADDRESS, title: "Visual Designer", employer: "Somewhere" },
      {
        link: linkTo(SAME_POSTING.hostAndPath),
        title: SAME_POSTING.title,
        employer: SAME_POSTING.employer,
        description: SAME_POSTING.description,
      },
      {
        link: `${linkTo(SAME_POSTING.hostAndPath)}${TRACKING}`,
        title: SAME_POSTING.title,
        employer: SAME_POSTING.employer,
        description: SAME_POSTING.description,
      },
    ];

    globalThis.fetch = sites.fetch;

    const trace = createTraceService(db);
    result = await runAddExternalJobs({
      submissions,
      settings: createSettingsService(db),
      companies: createCompanyService(db),
      atsSlugs: createAtsSlugService(db),
      jobService: createJobService(db),
      openBrowser: fakeResolutionBrowser(pages),
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
    // The headings a job search's summary prints for this same run's records.
    // An indented line belongs to a heading, and a blank one separates them.
    summaryHeadings = summaryFromTraceCounts(await trace.countsForRun(RUN_ID), [], null).filter(
      (line) => line !== "" && !line.startsWith(" ")
    );
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    await sites.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("One link is added", async () => {
    const job = await jobFor(linkTo(NEAR_ONE.hostAndPath));
    expect(job?.original_url).toBe(linkTo(NEAR_ONE.hostAndPath));
    expect(job?.raw_title).toBe(NEAR_ONE.title);
    expect(job?.company?.name).toBe(NEAR_ONE.employer);
    expect(job?.description).toBe(NEAR_ONE.description);
  });

  test("Each link in a list is added", async () => {
    const links = [NEAR_ONE, NEAR_TWO, BLANK, SAME_POSTING].map((posting) =>
      linkTo(posting.hostAndPath)
    );
    const ids = links.map((link) => outcomeFor(link).jobId);
    for (const [index, link] of links.entries()) {
      expect(ids[index], link).not.toBeNull();
      expect(await jobFor(link), link).not.toBeNull();
    }
    expect(new Set(ids).size).toBe(links.length);
  });

  test("A link that is not a web address is not saved", async () => {
    expect(outcomeFor(NOT_A_WEB_ADDRESS).jobId).toBeNull();
    expect(await db.job.count({ where: { original_url: NOT_A_WEB_ADDRESS } })).toBe(0);
    expect(await db.job.count({ where: { raw_title: "Visual Designer" } })).toBe(0);
  });

  test("A refused link is named in a warning", () => {
    expect(result.warnings.some((warning) => warning.message.includes(NOT_A_WEB_ADDRESS))).toBe(
      true
    );
  });

  test("One failing link costs only itself", async () => {
    // Four postings stand behind the five web addresses, two of which are one
    // posting, and the refused link holds none of them.
    expect(await db.job.count()).toBe(4);
    for (const posting of [NEAR_ONE, NEAR_TWO, BLANK, SAME_POSTING]) {
      const link = linkTo(posting.hostAndPath);
      expect(await db.job.count({ where: { original_url: { startsWith: link } } }), link).toBe(1);
    }
  });

  test("A duplicate merges as in a job search", async () => {
    const plain = outcomeFor(linkTo(SAME_POSTING.hostAndPath)).jobId;
    const tracked = outcomeFor(`${linkTo(SAME_POSTING.hostAndPath)}${TRACKING}`).jobId;
    expect(plain).not.toBeNull();
    expect(tracked).toBe(plain);
    expect(
      await db.job.count({
        where: { original_url: { startsWith: linkTo(SAME_POSTING.hostAndPath) } },
      })
    ).toBe(1);
  });

  test("A job with no title or employer still travels", async () => {
    const job = await jobFor(linkTo(BLANK.hostAndPath));
    expect(job?.original_url).toBe(linkTo(BLANK.hostAndPath));
  });

  test("No run summary", () => {
    expect(summaryHeadings.length).toBeGreaterThan(0);
    for (const heading of summaryHeadings) {
      expect(report, heading).not.toContain(heading);
    }
  });

  test("Warnings are printed", () => {
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const warning of result.warnings) {
      expect(
        report.some((line) => line.includes(warning.message)),
        warning.message
      ).toBe(true);
    }
  });

  test("Each job's final status is printed", () => {
    for (const posting of [NEAR_ONE, NEAR_TWO, SAME_POSTING]) {
      const outcome = outcomeFor(linkTo(posting.hostAndPath));
      expect(outcome.status, posting.title).not.toBeNull();
      const line = report.find(
        (candidate) => candidate.includes(posting.title) && candidate.includes(posting.employer)
      );
      expect(line, posting.title).toBeDefined();
      expect(line).toContain(String(outcome.status));
    }
  });
});
