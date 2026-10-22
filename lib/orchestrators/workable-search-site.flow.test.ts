// Flow test: A Workable search-site job guesses its employer's board.
//
// Workable runs a job search site listing every employer's jobs, and a job
// there never names the employer's board. Three such jobs wait in the
// backlog, one per employer, each already followed to its search-site page:
//
// - Manila Recruitment, whose dashed name loads an empty board and whose
//   undashed name loads a board with jobs. Measured 2026-09-24:
//   `manila-recruitment` was empty and `manilarecruitment` held the jobs. The
//   same job is also already stored from Workable's company site, read before
//   this run, as xponentiate's and GoTymeX's were on 2026-09-24.
// - IBMC, whose only guessed board is empty, as `ibmc` was on 2026-09-24.
// - Pet Lab Co., whose names load no board at all, as PetLabCo.'s did on
//   2026-09-24. Its website's name differs from its own, so the order the
//   three spellings are tried in can be read off the requests.
//
// A job search reads all three, and the test checks what each job holds,
// which board, if any, each employer ends up with, and that the job stored
// from both sites remains once.
//
// Real services run against a scratch database. The one thing standing in is
// Workable: global fetch is swapped for a stand-in server answering the search
// site's job address and the company site's board list address, in the shapes
// they returned when measured live on 2026-09-24. Nothing here reaches a real
// website.
//
// Covers: A search-site job fills its description, A search-site job fills its
// employer name, A search-site job is read when no board is found, A
// search-site job records the first guessed board listing jobs, An empty
// guessed board is not recorded, A search-site job with no board found records
// none, One job from both Workable sites is kept once.
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
import { normalizeCompanyName } from "../utils/company-name";
import { normalizeTitle } from "../utils/title";
import { runJobSearch } from "./job-search";
import { createLastSuccessService } from "../services/last-success-service";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and a job search runs after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

const RUN_AT = new Date("2026-09-01T10:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

// One employer's job on the search site, and what Workable holds for it.
interface SearchSiteJob {
  // The identifier in the search-site link, which the job address takes.
  viewId: string;
  employer: string;
  website: string;
  title: string;
  // A sentence only this job's description holds.
  description: string;
  // Every board name the parser is expected to try, in order: the employer's
  // name with dashes, without dashes, then the first part of its website.
  guesses: string[];
}

const MANILA: SearchSiteJob = {
  viewId: "tyaZq6jybgHCVRBowKxp43",
  employer: "Manila Recruitment",
  website: "http://manilarecruitment.com",
  title: "Senior Product Designer, Growth",
  description: "Own the growth experiments for a remote client team.",
  guesses: ["manila-recruitment", "manilarecruitment"],
};

const IBMC: SearchSiteJob = {
  viewId: "Qm7pRtX2vLk9sNw4Hj8cYd",
  employer: "IBMC",
  website: "https://www.ibmc.com",
  title: "UX Designer, Claims",
  description: "Design the claims portal policyholders use after an accident.",
  guesses: ["ibmc"],
};

const PET_LAB: SearchSiteJob = {
  viewId: "Zx4bNc8vQw2eRt6yUi0oPa",
  employer: "Pet Lab Co.",
  website: "https://thepetlabco.com",
  title: "Product Designer, Subscriptions",
  description: "Shape how pet owners manage their monthly supplement boxes.",
  guesses: ["pet-lab-co", "petlabco", "thepetlabco"],
};

const SEARCH_SITE_JOBS = [MANILA, IBMC, PET_LAB];

const searchSiteLink = (job: SearchSiteJob) =>
  `https://jobs.workable.com/view/${job.viewId}/${job.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;

const idFor = (job: SearchSiteJob) => `job-search-site-${job.guesses[0]}`;

// Manila Recruitment's board, and its company-site link for the job the
// search site also lists.
const MANILA_BOARD = "manilarecruitment";
const MANILA_COMPANY_SITE_LINK = `https://apply.workable.com/${MANILA_BOARD}/j/AB12CD34EF`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const notFound = () => json({ error: "not found" }, 404);

// A board's job list, as the widget address answers it.
function widget(name: string, jobs: { title: string; shortcode: string }[]) {
  return {
    name,
    description: "",
    jobs: jobs.map((job) => ({
      title: job.title,
      shortcode: job.shortcode,
      code: null,
      employment_type: "Full-time",
      telecommuting: true,
      department: "Design",
      url: `https://apply.workable.com/j/${job.shortcode}`,
      shortlink: `https://apply.workable.com/j/${job.shortcode}`,
      application_url: `https://apply.workable.com/j/${job.shortcode}/apply`,
      published_on: "2026-08-30",
      created_at: "2026-08-28",
      country: "Philippines",
      city: "Manila",
      state: "Metro Manila",
      locations: [],
    })),
  };
}

// Every board the stand-in holds, by name. A name missing from this list
// answers 404, the way Workable answers a board that does not exist.
const BOARDS: Record<string, unknown> = {
  "manila-recruitment": widget("Manila Recruitment", []),
  [MANILA_BOARD]: widget("Manila Recruitment", [{ title: MANILA.title, shortcode: "AB12CD34EF" }]),
  ibmc: widget("IBMC", []),
};

// One search-site job, as the job address answers it.
function searchSiteJob(job: SearchSiteJob) {
  return {
    company: {
      id: `company-${job.viewId}`,
      title: job.employer,
      description: "",
      url: `https://jobs.workable.com/company/${job.viewId}/jobs-at-${job.guesses[0]}`,
      website: job.website,
    },
    created: "2026-08-30T10:59:09.401Z",
    description: `<p>${job.description}</p>`,
    requirementsSection: "<p>Five years of product design.</p>",
    benefitsSection: "<p>A long-term contract.</p>",
    employmentType: "Full-time",
    id: `id-${job.viewId}`,
    location: { city: "Manila", countryName: "Philippines", subregion: null },
    locations: ["TELECOMMUTE"],
    state: "published",
    title: job.title,
    updated: "2026-08-30T10:59:09.401Z",
    url: searchSiteLink(job),
    workplace: "remote",
    language: "en",
    department: "Design",
    linkoutUrl: null,
  };
}

// Stands in for Workable's two sites. Every address asked for is recorded, so
// a test can read which board names were tried and in what order.
function workableStandIn(addresses: URL[]): typeof fetch {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    addresses.push(url);

    if (url.host === "jobs.workable.com") {
      const match = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/);
      const job = SEARCH_SITE_JOBS.find((candidate) => candidate.viewId === match?.[1]);
      return job ? json(searchSiteJob(job)) : notFound();
    }

    if (url.host === "apply.workable.com") {
      const match = url.pathname.match(/^\/api\/v1\/widget\/accounts\/([^/]+)$/);
      const board = match ? BOARDS[match[1] ?? ""] : undefined;
      return board ? json(board) : notFound();
    }

    return notFound();
  };
}

// The board names tried through the widget address, in the order tried.
function triedBoardNames(addresses: URL[]): string[] {
  return addresses
    .filter((url) => url.host === "apply.workable.com")
    .map((url) => url.pathname.match(/^\/api\/v1\/widget\/accounts\/([^/]+)$/)?.[1])
    .filter((name): name is string => name !== undefined);
}

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
      latitude: 14.5995,
      longitude: 120.9842,
      place_type: "city",
      display_name: "Manila, Philippines",
      outline: null,
    };
  },
});

interface StoredJob {
  description: string | null;
  raw_company_name: string | null;
  company_id: string | null;
}

describe("A Workable search-site job guesses its employer's board", () => {
  const originalFetch = globalThis.fetch;
  const addresses: URL[] = [];
  let dir: string;
  let db: PipelineDb;

  let manilaCompanyId: string;
  const jobs: Record<string, StoredJob | null> = {};
  let boards: { slug: string; parser: string; company_id: string }[];
  let manilaJobCount: number;

  // The board rows held for the company a search-site job ended on. A job that
  // reached no company holds none.
  const boardsFor = (job: SearchSiteJob) => {
    const companyId = jobs[job.employer]?.company_id ?? null;
    return companyId === null ? [] : boards.filter((row) => row.company_id === companyId);
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-workable-search-site-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const jobService = createJobService(db);
    const priorityList = await settings.getSourcePriorityList();
    const identifyingQueryValues = await settings.getIdentifyingQueryValues();

    // Manila Recruitment's company-site job, stored and read before this run.
    // Its title is stored the way normalization would have stored it, since
    // duplicate matching compares normalized titles. Its board row is left
    // unwritten, so any board row this employer holds afterwards came from
    // the search-site job's guess.
    const { company } = await companies.create({ name: MANILA.employer });
    manilaCompanyId = company.id;
    const vocabularies = {
      headNouns: await settings.getTitleHeadNouns(),
      levels: await settings.getTitleLevels(),
      suffixes: await settings.getTitleSuffixes(),
      removalWords: await settings.getTitleRemovalWords(),
    };
    const storedFromCompanySite = await saveJobs(
      [
        {
          id: "job-company-site-manila",
          original_url: MANILA_COMPANY_SITE_LINK,
          resolved_url: MANILA_COMPANY_SITE_LINK,
          raw_title: MANILA.title,
          title: normalizeTitle(MANILA.title, vocabularies).title,
          raw_company_name: MANILA.employer,
          raw_company_slug: MANILA_BOARD,
          company_id: manilaCompanyId,
          description: `<p>${MANILA.description}</p>`,
          posting_date: new Date("2026-08-28T00:00:00.000Z"),
          collector: "adzuna",
          parser: "workable",
          collected_at: RUN_AT,
          status: "backlog",
          is_resolved: true,
          is_parsed: true,
          is_classified: true,
        },
      ],
      { jobService, priorityList, identifyingQueryValues }
    );
    if (storedFromCompanySite.jobs.length !== 1) {
      throw new Error(`the company-site job did not save: ${JSON.stringify(storedFromCompanySite.warnings)}`);
    }

    // The three search-site jobs, each already followed to its search-site
    // page and waiting to be read. The link names no employer, so none
    // carries one yet.
    const saved = await saveJobs(
      SEARCH_SITE_JOBS.map((job) => ({
        id: idFor(job),
        original_url: searchSiteLink(job),
        resolved_url: searchSiteLink(job),
        raw_title: job.title,
        collector: "adzuna",
        collected_at: RUN_AT,
        status: "backlog",
        is_resolved: true,
        is_parsed: false,
        is_classified: false,
      })),
      { jobService, priorityList, identifyingQueryValues }
    );
    if (saved.jobs.length !== SEARCH_SITE_JOBS.length) {
      throw new Error(`the search-site jobs did not save: ${JSON.stringify(saved.warnings)}`);
    }

    globalThis.fetch = workableStandIn(addresses);

    await runJobSearch({
      settings,
      companies,
      lastSuccesses: createLastSuccessService(db),
      atsSlugs: createAtsSlugService(db),
      jobService,
      collectors: [],
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      collectedAt: RUN_AT,
      runId: "run-search-site",
      trace: createTraceService(db),
      log: () => {},
    });

    for (const job of SEARCH_SITE_JOBS) {
      jobs[job.employer] = await db.job.findUnique({
        where: { id: idFor(job) },
        select: { description: true, raw_company_name: true, company_id: true },
      });
    }
    // Manila Recruitment's search-site job may have been folded into its
    // company-site row, so its fields are read from whichever row survived.
    if (jobs[MANILA.employer] === null) {
      jobs[MANILA.employer] = await db.job.findUnique({
        where: { id: "job-company-site-manila" },
        select: { description: true, raw_company_name: true, company_id: true },
      });
    }

    boards = await db.atsSlug.findMany({ select: { slug: true, parser: true, company_id: true } });
    // Counted by the role's title rather than by employer, because a job that
    // was never read carries no employer and would slip past an employer count.
    manilaJobCount = await db.job.count({ where: { raw_title: MANILA.title } });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("A search-site job fills its description", () => {
    expect(jobs[IBMC.employer]?.description ?? "").toContain(IBMC.description);
  });

  test("A search-site job fills its employer name", () => {
    // Normalization tidies every stored name, dropping a trailing period, so
    // "Pet Lab Co." is stored as "Pet Lab Co".
    for (const job of SEARCH_SITE_JOBS) {
      expect(jobs[job.employer]?.raw_company_name).toBe(normalizeCompanyName(job.employer));
    }
  });

  test("A search-site job is read when no board is found", () => {
    expect(jobs[PET_LAB.employer]?.description ?? "").toContain(PET_LAB.description);
  });

  test("A search-site job records the first guessed board listing jobs", () => {
    expect(jobs[MANILA.employer]?.company_id).toBe(manilaCompanyId);
    expect(boardsFor(MANILA)).toEqual([
      { slug: MANILA_BOARD, parser: "workable", company_id: manilaCompanyId },
    ]);
    // The dashed spelling is tried first, and the undashed one only after it.
    expect(triedBoardNames(addresses).filter((name) => MANILA.guesses.includes(name))).toEqual(
      MANILA.guesses
    );
    // With no board found, every spelling is tried, in order.
    expect(triedBoardNames(addresses).filter((name) => PET_LAB.guesses.includes(name))).toEqual(
      PET_LAB.guesses
    );
  });

  test("An empty guessed board is not recorded", () => {
    const slugs = boards.map((row) => row.slug);
    expect(slugs).not.toContain("manila-recruitment");
    expect(slugs).not.toContain("ibmc");
    // The empty board was still tried, so leaving it out was a decision.
    expect(triedBoardNames(addresses)).toContain("ibmc");
  });

  test("A search-site job with no board found records none", () => {
    expect(jobs[PET_LAB.employer]?.description ?? "").toContain(PET_LAB.description);
    expect(boardsFor(PET_LAB)).toEqual([]);
    expect(boardsFor(IBMC)).toEqual([]);
  });

  test("One job from both Workable sites is kept once", () => {
    expect(manilaJobCount).toBe(1);
  });
});
