// Flow test: Pay and work mode come from the description.
//
// One job per system — Workable, Gem, SmartRecruiters, BambooHR and Rippling —
// waits in the backlog, already followed to its posting. Each posting's feed
// publishes no pay and no work mode, and each description states both. Gem
// publishes pay only inside the description on every posting (measured
// 2026-09-24), and the others leave their pay and mode fields empty on some.
// A job search reads all five, and the test checks each job's pay and mode.
//
// Real services run against a scratch database. The one thing standing in is
// the five hiring systems: global fetch is swapped for a stand-in server
// answering the addresses the spec names for each system's board list and
// single posting, with every pay and work-mode field left out. Nothing here
// reaches a real website.
//
// Covers: Pay missing from the feed is read from the description, Work mode
// missing from the feed is read from the description.
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
import { saveJobs } from "../handlers/save";
import { runJobSearch } from "./job-search";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and a job search runs after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

// The description every posting carries: a pay range and a work mode, in the
// wording the shared description reader is already proven against.
const DESCRIPTION =
  "<p>Lead design for our booking flow.</p>" +
  "<p>The range for this role is $120,000 - $150,000 per year.</p>" +
  "<p>This role is remote.</p>";
const PAY_LOW = 120000;
const PAY_HIGH = 150000;
const MODE = "remote";

const TRACKING = "utm_source=adzuna&utm_medium=adzuna";

// Each waiting job, by the system whose parser reads it.
const JOBS: { system: string; employer: string; link: string }[] = [
  { system: "workable", employer: "Northwind Labs", link: "https://apply.workable.com/northwind/j/3C1D2E4F5A" },
  { system: "gem", employer: "Brightline Freight", link: `https://jobs.gem.com/brightline/4621632004?${TRACKING}` },
  {
    system: "smartrecruiters",
    employer: "Harborview Health",
    link: "https://jobs.smartrecruiters.com/Harborview/744000147869999-product-designer",
  },
  { system: "bamboohr", employer: "Quillsoft", link: `https://quillsoft.bamboohr.com/careers/40?${TRACKING}` },
  {
    system: "rippling",
    employer: "Lumenworks",
    link: `https://ats.rippling.com/lumenworks/jobs/371ee603-a211-467c-b868-b5f5b68ccbff?${TRACKING}`,
  },
];

const titleFor = (system: string) => `Product Designer, ${system}`;
const employerOf = (system: string) => JOBS.find((job) => job.system === system)?.employer ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const notFound = () => json({ error: "not found" }, 404);

// Each system's posting and board list, with every pay and work-mode field
// left out: no Workable workplace or remote flag, no Gem location type, no
// SmartRecruiters remote or hybrid flag, no BambooHR compensation or location
// type, and an empty Rippling pay-range list. Everything else keeps the shape
// it had when measured on 2026-09-24.
function reply(url: URL): Response {
  const path = url.pathname;

  if (url.host === "apply.workable.com") {
    if (path === "/api/v1/widget/accounts/northwind") {
      return json({ name: employerOf("workable"), description: "", jobs: [] });
    }
    if (path === "/api/v2/accounts/northwind/jobs/3C1D2E4F5A") {
      return json({
        id: 6083341,
        shortcode: "3C1D2E4F5A",
        title: titleFor("workable"),
        location: { countryCode: "PT", country: "Portugal", region: "Lisbon", city: "Lisbon", display: "Lisbon, Portugal" },
        locations: [{ country: "Portugal", countryCode: "PT", city: "Lisbon", region: "Lisbon", hidden: false }],
        state: "published",
        published: "2026-08-30T00:00:00.000Z",
        type: "full",
        language: "en",
        department: ["Design"],
        description: DESCRIPTION,
        requirements: "",
        benefits: "",
      });
    }
  }

  if (url.host === "api.gem.com") {
    const posting = {
      absolute_url: "https://jobs.gem.com/brightline/4621632004",
      content: DESCRIPTION,
      content_plain: DESCRIPTION.replace(/<[^>]+>/g, " "),
      created_at: "2026-08-28T22:26:01.000Z",
      employment_type: "full_time",
      first_published_at: "2026-08-30T22:51:02.331Z",
      id: "4621632004",
      location: { name: "Denver, CO" },
      title: titleFor("gem"),
      updated_at: "2026-08-31T16:08:06.647Z",
    };
    if (path.replace(/\/$/, "") === "/job_board/v0/brightline/job_posts") return json([posting]);
    if (path === "/job_board/v0/brightline/job_posts/4621632004") return json(posting);
  }

  if (url.host === "api.smartrecruiters.com") {
    const lower = path.toLowerCase();
    if (lower === "/v1/companies/harborview/postings") {
      return json({ offset: 0, limit: 100, totalFound: 0, content: [] });
    }
    if (lower === "/v1/companies/harborview/postings/744000147869999") {
      return json({
        id: "744000147869999",
        name: titleFor("smartrecruiters"),
        company: { identifier: "Harborview", name: employerOf("smartrecruiters") },
        location: { city: "Toronto", region: "ON", country: "ca", fullLocation: "Toronto, ON, Canada" },
        releasedDate: "2026-08-30T18:30:40.900Z",
        postingUrl: "https://jobs.smartrecruiters.com/Harborview/744000147869999",
        jobAd: {
          sections: {
            companyDescription: { title: "Company Description", text: "<p>Harborview runs clinics.</p>" },
            jobDescription: { title: "Job Description", text: DESCRIPTION },
            qualifications: { title: "Qualifications", text: "<ul><li>Five years of design</li></ul>" },
            additionalInformation: { title: "Additional Information", text: "" },
          },
        },
        active: true,
        visibility: "PUBLIC",
        typeOfEmployment: { id: "permanent", label: "Full-time" },
      });
    }
  }

  if (url.host === "quillsoft.bamboohr.com") {
    if (path === "/careers/list") return json({ meta: { totalCount: 0 }, result: [] });
    if (path === "/careers/40/detail") {
      return json({
        meta: {},
        result: {
          jobOpening: {
            jobOpeningShareUrl: "https://quillsoft.bamboohr.com/careers/40",
            jobOpeningName: titleFor("bamboohr"),
            jobOpeningStatus: "Open",
            departmentLabel: "Product",
            employmentStatusLabel: "Full-Time",
            location: { city: null, state: null, postalCode: null, addressCountry: null },
            atsLocation: { country: "United States", state: "Oregon", city: "Portland" },
            description: DESCRIPTION,
            datePosted: "2026-08-30",
          },
        },
      });
    }
  }

  if (url.host === "api.rippling.com") {
    const prefix = "/platform/api/ats/v1/board/lumenworks/jobs";
    if (path === prefix) return json([]);
    if (path === `${prefix}/371ee603-a211-467c-b868-b5f5b68ccbff`) {
      return json({
        uuid: "371ee603-a211-467c-b868-b5f5b68ccbff",
        name: titleFor("rippling"),
        description: { company: "<p>Lumenworks builds lighting controls.</p>", role: DESCRIPTION },
        workLocations: ["Boulder, CO"],
        department: { name: "Product" },
        employmentType: { label: "SALARIED_FT", id: "Salaried, full-time" },
        createdOn: "2026-08-30T13:22:49.176000-07:00",
        url: "https://ats.rippling.com/lumenworks/jobs/371ee603-a211-467c-b868-b5f5b68ccbff",
        board: { boardType: "RIPPLING", slug: "lumenworks", companyName: employerOf("rippling") },
        payRangeDetails: [],
        companyName: employerOf("rippling"),
      });
    }
  }

  return notFound();
}

const standIn: typeof fetch = async (input: string | URL | Request) =>
  reply(new URL(input instanceof Request ? input.url : String(input)));

// A browser that stays wherever it is sent. The stored jobs arrive already
// followed to their posting, so nothing here needs a real one; this only
// keeps the run whole if a job ever reaches resolution.
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

// Answers every place lookup, so the run never reaches a mapping service.
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

interface StoredJob {
  raw_salary: unknown;
  raw_mode_list: unknown;
}

describe("Pay and work mode come from the description", () => {
  const originalFetch = globalThis.fetch;
  let dir: string;
  let db: PipelineDb;
  const stored: Record<string, StoredJob | null> = {};

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-description-fields-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);

    const entries = [];
    for (const job of JOBS) {
      const { company } = await companies.create({ name: job.employer });
      entries.push({
        id: `job-${job.system}`,
        original_url: job.link,
        resolved_url: job.link,
        raw_title: titleFor(job.system),
        raw_company_name: job.employer,
        company_id: company.id,
        collector: "adzuna",
        collected_at: RUN_AT,
        status: "backlog",
        is_resolved: true,
        is_parsed: false,
        is_classified: false,
      });
    }
    const saved = await saveJobs(entries, {
      jobService,
      priorityList: await settings.getSourcePriorityList(),
      identifyingQueryValues: await settings.getIdentifyingQueryValues(),
    });
    if (saved.jobs.length !== JOBS.length) {
      throw new Error(`the waiting jobs did not save: ${JSON.stringify(saved.warnings)}`);
    }

    globalThis.fetch = standIn;

    await runJobSearch({
      settings,
      companies,
      atsSlugs: createAtsSlugService(db),
      jobService,
      collectors: [],
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      collectedAt: RUN_AT,
      runId: "run-description-fields",
      trace: createTraceService(db),
      log: () => {},
    });

    for (const job of JOBS) {
      stored[job.system] = await db.job.findUnique({
        where: { id: `job-${job.system}` },
        select: { raw_salary: true, raw_mode_list: true },
      });
    }
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  describe.each(JOBS)("$system", (job) => {
    test("Pay missing from the feed is read from the description", () => {
      expect(stored[job.system]?.raw_salary).toMatchObject({ salary_min: PAY_LOW, salary_max: PAY_HIGH });
    });

    test("Work mode missing from the feed is read from the description", () => {
      expect(stored[job.system]?.raw_mode_list).toEqual([MODE]);
    });
  });
});
