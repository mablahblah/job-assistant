// Flow test: A job on each of the five systems is read, and its employer's
// board is polled.
//
// Walks the whole path an employer on Workable, Gem, SmartRecruiters, BambooHR
// or Rippling takes into direct polling. One job per system waits in the
// backlog, each already followed to its posting by an aggregator, and each
// link written the awkward way stored links were on 2026-09-24: a Workable
// link ending in a slash, a Gem link with a numeric identifier, a
// SmartRecruiters link carrying the job title after its identifier, and Gem,
// BambooHR and Rippling links carrying tracking values. A job search reads
// all five postings, scoring rates every employer above the promotion bar,
// and a second job search polls the boards promotion put on each collector's
// list.
//
// Real services run against a scratch database. The one thing standing in is
// the five hiring systems: global fetch is swapped for a stand-in server
// answering the addresses the spec names for each system's board list and
// single posting, in the shapes those addresses returned when measured live
// on 2026-09-24. Nothing here reaches a real website.
//
// Covers: A posting fills the job's description, A posting fills the job's
// location, A posting fills the job's employer name, Tracking values do not
// stop a link being read, A trailing slash does not stop a link being read, A
// SmartRecruiters link carrying the job title is read, A Gem link with a
// numeric identifier is read, A posting records the board in its link, A
// high-scoring employer on the five systems is promoted, A promoted board is
// polled, A collected job links to its posting.
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
import { COLLECTORS } from "../collectors/registry";
import { saveJobs } from "../handlers/save";
import { runJobSearch, type RunJobSearchOptions } from "./job-search";
import { runScoringSave } from "./scoring";

// This file lives in lib/orchestrators/, so the repo root is two levels up.
const orchestratorsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(orchestratorsDir, "..", "..");

// Creating and seeding each spawn npx tsx, and two job searches run after.
// A ceiling rather than a budget.
const SETUP_TIMEOUT_MS = 120_000;

const FIRST_RUN_AT = new Date("2026-09-01T10:00:00.000Z");
const SCORED_AT = new Date("2026-09-01T11:00:00.000Z");
const SECOND_RUN_AT = new Date("2026-09-02T10:00:00.000Z");

type PipelineDb = ReturnType<typeof createPipelineDb>;

// The one search term, set explicitly so which titles match does not depend
// on the seeded defaults.
const SEARCH_TERM = "Product Designer";

// One system's part in the test: the job waiting in the backlog, the board
// its link names, and the job the board lists on the second run.
interface System {
  // The parser's and collector's name, which is also what a board row carries.
  name: string;
  // The employer, named the way the aggregator named it.
  employer: string;
  // The board named in the waiting job's link.
  board: string;
  // The waiting job's link, exactly as stored.
  link: string;
  // A sentence only this system's posting description holds.
  description: string;
  // A place only this system's posting names.
  city: string;
  // The host a collected job's link must sit on, and a piece of that link
  // naming the polled job, so the link is known to open that job's posting.
  postingHost: string;
  polledJobMarker: string;
  // Whether a request is this collector asking for its board's job list, at
  // the address the spec names for that system.
  isBoardListRequest: (url: URL) => boolean;
}

// Job identifiers the stand-in serves. Each read job and each polled job has
// its own, so no two are one posting.
const WORKABLE_READ = "3C1D2E4F5A";
const WORKABLE_POLLED = "7A8B9C0D1E";
// A plain number, the second of Gem's two identifier formats.
const GEM_READ = "4621632004";
const GEM_POLLED = "4700000001";
const SMARTRECRUITERS_READ = "744000147869999";
const SMARTRECRUITERS_POLLED = "744000150000001";
const BAMBOOHR_READ = "40";
const BAMBOOHR_POLLED = "52";
const RIPPLING_READ = "371ee603-a211-467c-b868-b5f5b68ccbff";
const RIPPLING_POLLED = "26c570f3-8f64-43f1-a641-52cfeb9471b3";

const TRACKING = "utm_source=adzuna&utm_medium=adzuna";

const SYSTEMS: System[] = [
  {
    name: "workable",
    employer: "Northwind Labs",
    board: "northwind",
    // Ends in a slash, as some stored Workable links do.
    link: `https://apply.workable.com/northwind/j/${WORKABLE_READ}/`,
    description: "Shape how Northwind's customers plan their week.",
    city: "Lisbon",
    postingHost: "apply.workable.com",
    polledJobMarker: WORKABLE_POLLED,
    isBoardListRequest: (url) =>
      url.host === "apply.workable.com" && url.pathname === "/api/v1/widget/accounts/northwind",
  },
  {
    name: "gem",
    employer: "Brightline Freight",
    board: "brightline",
    link: `https://jobs.gem.com/brightline/${GEM_READ}?${TRACKING}`,
    description: "Design the dispatch tools Brightline's drivers use every day.",
    city: "Denver",
    postingHost: "jobs.gem.com",
    polledJobMarker: GEM_POLLED,
    isBoardListRequest: (url) =>
      url.host === "api.gem.com" &&
      url.pathname.replace(/\/$/, "") === "/job_board/v0/brightline/job_posts",
  },
  {
    name: "smartrecruiters",
    employer: "Harborview Health",
    board: "Harborview",
    // Carries the job title after its identifier, which the detail address
    // refuses (measured 2026-09-24).
    link: `https://jobs.smartrecruiters.com/Harborview/${SMARTRECRUITERS_READ}-senior-product-designer`,
    description: "Redesign how Harborview's patients book their visits.",
    city: "Toronto",
    postingHost: "jobs.smartrecruiters.com",
    polledJobMarker: SMARTRECRUITERS_POLLED,
    isBoardListRequest: (url) =>
      url.host === "api.smartrecruiters.com" &&
      url.pathname.toLowerCase() === "/v1/companies/harborview/postings",
  },
  {
    name: "bamboohr",
    employer: "Quillsoft",
    board: "quillsoft",
    link: `https://quillsoft.bamboohr.com/careers/${BAMBOOHR_READ}?${TRACKING}`,
    description: "Own the design of Quillsoft's document editor.",
    city: "Portland",
    postingHost: "quillsoft.bamboohr.com",
    polledJobMarker: `/careers/${BAMBOOHR_POLLED}`,
    isBoardListRequest: (url) =>
      url.host === "quillsoft.bamboohr.com" && url.pathname === "/careers/list",
  },
  {
    name: "rippling",
    employer: "Lumenworks",
    board: "lumenworks",
    link: `https://ats.rippling.com/lumenworks/jobs/${RIPPLING_READ}?${TRACKING}`,
    description: "Lead design for Lumenworks' lighting control app.",
    city: "Boulder",
    postingHost: "ats.rippling.com",
    polledJobMarker: RIPPLING_POLLED,
    isBoardListRequest: (url) =>
      url.host === "api.rippling.com" &&
      url.pathname === "/platform/api/ats/v1/board/lumenworks/jobs",
  },
];

const system = (name: string): System => {
  const found = SYSTEMS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no system named ${name}`);
  return found;
};

// The title of each system's waiting job, and of the job its board lists on
// the second run. Different titles, so duplicate matching never folds the one
// into the other.
const READ_TITLE = "Product Designer, Growth";
const POLLED_TITLE = "Lead Product Designer, Platform";
// A job every board also lists whose title matches no search term.
const OTHER_TITLE = "Accounts Payable Clerk";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const notFound = () => json({ error: "not found" }, 404);

// Workable's company site. The board list is the documented widget address;
// a single posting is the address the company site's own page calls. Neither
// carries the other's fields: the widget names the employer, the posting
// carries the description (measured 2026-09-24).
function workable(url: URL): Response | null {
  if (url.host !== "apply.workable.com") return null;
  const s = system("workable");

  if (url.pathname === `/api/v1/widget/accounts/${s.board}`) {
    const listing = (title: string, shortcode: string) => ({
      title,
      shortcode,
      code: null,
      employment_type: "Full-time",
      telecommuting: false,
      department: "Design",
      url: `https://apply.workable.com/j/${shortcode}`,
      shortlink: `https://apply.workable.com/j/${shortcode}`,
      application_url: `https://apply.workable.com/j/${shortcode}/apply`,
      published_on: "2026-08-30",
      created_at: "2026-08-28",
      country: "Portugal",
      city: s.city,
      state: "Lisbon",
      locations: [{ country: "Portugal", countryCode: "PT", city: s.city, region: "Lisbon", hidden: false }],
    });
    return json({
      name: s.employer,
      description: "",
      jobs: [listing(POLLED_TITLE, WORKABLE_POLLED), listing(OTHER_TITLE, "9F9F9F9F9F")],
    });
  }

  const posting = url.pathname.match(/^\/api\/v2\/accounts\/([^/]+)\/jobs\/([^/]+)$/);
  if (posting && posting[1] === s.board && [WORKABLE_READ, WORKABLE_POLLED].includes(posting[2] ?? "")) {
    const shortcode = posting[2];
    return json({
      id: 6083341,
      shortcode,
      title: shortcode === WORKABLE_READ ? READ_TITLE : POLLED_TITLE,
      remote: false,
      location: {
        countryCode: "PT",
        country: "Portugal",
        region: "Lisbon",
        city: s.city,
        display: `${s.city}, Portugal`,
      },
      locations: [{ country: "Portugal", countryCode: "PT", city: s.city, region: "Lisbon", hidden: false }],
      state: "published",
      isInternal: false,
      code: null,
      published: "2026-08-30T00:00:00.000Z",
      type: "full",
      language: "en",
      department: ["Design"],
      workplace: "hybrid",
      description: `<p>${s.description}</p>`,
      requirements: "",
      benefits: "",
    });
  }

  return notFound();
}

// Gem's documented job board API. A posting carries no employer name and no
// pay field, and its identifier may be a plain number (measured 2026-09-24).
function gem(url: URL): Response | null {
  if (url.host !== "api.gem.com") return null;
  const s = system("gem");
  const posting = (id: string, title: string) => ({
    absolute_url: `https://jobs.gem.com/${s.board}/${id}`,
    content: `<div><p>${s.description}</p></div>`,
    content_plain: s.description,
    created_at: "2026-08-28T22:26:01.000Z",
    departments: [{ child_ids: [], id: "4065390003", name: "Design", parent_id: null }],
    employment_type: "full_time",
    first_published_at: "2026-08-30T22:51:02.331Z",
    id,
    internal_job_id: "5681983003",
    location: { name: `${s.city}, CO` },
    location_type: "hybrid",
    offices: [],
    requisition_id: "P-BRT-930",
    title,
    updated_at: "2026-08-31T16:08:06.647Z",
  });

  const path = url.pathname.replace(/\/$/, "");
  const prefix = `/job_board/v0/${s.board}/job_posts`;
  if (path === prefix) {
    return json([posting(GEM_POLLED, POLLED_TITLE), posting("4700000002", OTHER_TITLE)]);
  }
  if (path === `${prefix}/${GEM_READ}`) return json(posting(GEM_READ, READ_TITLE));
  if (path === `${prefix}/${GEM_POLLED}`) return json(posting(GEM_POLLED, POLLED_TITLE));
  return notFound();
}

// SmartRecruiters' documented posting API. The company name in an address is
// accepted in any casing, and the single-posting address answers Bad Request
// to an identifier with the job title still attached (measured 2026-09-24).
function smartRecruiters(url: URL): Response | null {
  if (url.host !== "api.smartrecruiters.com") return null;
  const s = system("smartrecruiters");
  const location = {
    city: s.city,
    region: "ON",
    country: "ca",
    remote: false,
    hybrid: false,
    fullLocation: `${s.city}, ON, Canada`,
  };
  const listing = (id: string, name: string) => ({
    id,
    name,
    uuid: `uuid-${id}`,
    refNumber: `REF-${id}`,
    company: { identifier: s.board, name: s.employer },
    releasedDate: "2026-08-30T15:40:10.388Z",
    location,
    typeOfEmployment: { id: "permanent", label: "Full-time" },
    ref: `https://api.smartrecruiters.com/v1/companies/${s.board}/postings/${id}`,
  });

  const path = url.pathname.toLowerCase();
  const prefix = `/v1/companies/${s.board.toLowerCase()}/postings`;
  if (path === prefix) {
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const content = offset > 0 ? [] : [listing(SMARTRECRUITERS_POLLED, POLLED_TITLE), listing("744000150000002", OTHER_TITLE)];
    return json({ offset, limit: 100, totalFound: 2, content });
  }
  if (path.startsWith(`${prefix}/`)) {
    const id = path.slice(prefix.length + 1);
    if (id !== SMARTRECRUITERS_READ && id !== SMARTRECRUITERS_POLLED) {
      return json({ message: "Bad Request" }, 400);
    }
    return json({
      ...listing(id, id === SMARTRECRUITERS_READ ? READ_TITLE : POLLED_TITLE),
      postingUrl: `https://jobs.smartrecruiters.com/${s.board}/${id}`,
      applyUrl: `https://jobs.smartrecruiters.com/${s.board}/${id}`,
      jobAd: {
        sections: {
          companyDescription: { title: "Company Description", text: "<p>Harborview runs clinics.</p>" },
          jobDescription: { title: "Job Description", text: `<p>${s.description}</p>` },
          qualifications: { title: "Qualifications", text: "<ul><li>Five years of design</li></ul>" },
          additionalInformation: { title: "Additional Information", text: "<p>Benefits from day one.</p>" },
        },
      },
      active: true,
      visibility: "PUBLIC",
    });
  }
  return notFound();
}

// BambooHR's careers pages, each of which answers JSON when asked for it. No
// reply names the employer (measured 2026-09-24).
function bambooHr(url: URL): Response | null {
  if (!url.host.endsWith(".bamboohr.com")) return null;
  const s = system("bamboohr");
  if (url.host !== s.postingHost) return notFound();

  const atsLocation = { country: "United States", state: "Oregon", province: null, city: s.city };
  if (url.pathname === "/careers/list") {
    const listing = (id: string, jobOpeningName: string) => ({
      id,
      jobOpeningName,
      departmentId: "18592",
      departmentLabel: "Product",
      employmentStatusLabel: "Full-Time",
      location: { city: null, state: null },
      atsLocation,
      isRemote: null,
      locationType: "1",
    });
    return json({
      meta: { totalCount: 2 },
      result: [listing(BAMBOOHR_POLLED, POLLED_TITLE), listing("53", OTHER_TITLE)],
    });
  }

  const detail = url.pathname.match(/^\/careers\/(\d+)\/detail$/);
  if (detail && [BAMBOOHR_READ, BAMBOOHR_POLLED].includes(detail[1] ?? "")) {
    const id = detail[1];
    return json({
      meta: {},
      result: {
        jobOpening: {
          jobOpeningShareUrl: `https://${s.postingHost}/careers/${id}`,
          jobOpeningName: id === BAMBOOHR_READ ? READ_TITLE : POLLED_TITLE,
          jobOpeningStatus: "Open",
          departmentLabel: "Product",
          employmentStatusLabel: "Full-Time",
          location: { city: null, state: null, postalCode: null, addressCountry: null },
          atsLocation,
          description: `<p>${s.description}</p>`,
          compensation: "145k-185k",
          datePosted: "2026-08-30",
          locationType: "1",
        },
      },
    });
  }
  return notFound();
}

// Rippling's board addresses, the ones its own board page calls. A posting
// names the employer, and its pay-range list may be empty (measured
// 2026-09-24).
function rippling(url: URL): Response | null {
  if (url.host !== "api.rippling.com") return null;
  const s = system("rippling");
  const prefix = `/platform/api/ats/v1/board/${s.board}/jobs`;
  const postingLink = (uuid: string) => `https://ats.rippling.com/${s.board}/jobs/${uuid}`;

  if (url.pathname === prefix) {
    const listing = (uuid: string, name: string) => ({
      uuid,
      name,
      department: { id: "Product", label: "Product" },
      url: postingLink(uuid),
      workLocation: { label: `${s.city}, CO`, id: `${s.city}, CO` },
    });
    return json([
      listing(RIPPLING_POLLED, POLLED_TITLE),
      listing("5b1d7c2a-0000-4000-8000-000000000003", OTHER_TITLE),
    ]);
  }

  if (url.pathname.startsWith(`${prefix}/`)) {
    const uuid = url.pathname.slice(prefix.length + 1);
    if (uuid !== RIPPLING_READ && uuid !== RIPPLING_POLLED) return notFound();
    return json({
      uuid,
      name: uuid === RIPPLING_READ ? READ_TITLE : POLLED_TITLE,
      description: {
        company: "<div><p>Lumenworks builds lighting controls.</p></div>",
        role: `<div><p>${s.description}</p></div>`,
      },
      workLocations: [`${s.city}, CO`],
      department: { name: "Product", base_department: "Product", department_tree: ["Product"] },
      employmentType: { label: "SALARIED_FT", id: "Salaried, full-time" },
      createdOn: "2026-08-30T13:22:49.176000-07:00",
      url: postingLink(uuid),
      board: { boardType: "RIPPLING", slug: s.board, companyName: s.employer },
      payRangeDetails: [],
      companyName: s.employer,
    });
  }
  return notFound();
}

interface SentRequest {
  url: string;
  method: string;
}

// Stands in for all five systems at once. Every request is recorded, so a
// test can check what a collector asked for. Anything no system recognises
// answers 404, the way a real server answers an address it does not hold.
function standIn(requests: SentRequest[]): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const address = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url: address, method });
    const url = new URL(address);
    return (
      workable(url) ?? gem(url) ?? smartRecruiters(url) ?? bambooHr(url) ?? rippling(url) ?? notFound()
    );
  };
}

// A browser that stays wherever it is sent. The stored jobs arrive already
// followed to their posting, and a collected job is already its posting, so
// nothing here needs a real one; this only keeps the run whole if a job ever
// reaches resolution.
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

interface StoredJob {
  description: string | null;
  raw_location_list: unknown;
  raw_company_name: string | null;
  parser: string | null;
}

interface BoardRow {
  slug: string;
  parser: string;
  collector: string | null;
}

describe("A job on each of the five systems is read, and its employer's board is polled", () => {
  const originalFetch = globalThis.fetch;
  const requests: SentRequest[] = [];
  let dir: string;
  let db: PipelineDb;

  const readJobs: Record<string, StoredJob | null> = {};
  const boardsAfterReading: Record<string, BoardRow[]> = {};
  const boardsAfterPromotion: Record<string, BoardRow[]> = {};
  const collectedLinks: Record<string, string[]> = {};
  let secondRunRequests: URL[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-hiring-systems-flow-"));
    const url = `file:${join(dir, "pipeline.db")}`;
    runScript("db-create.ts", url);
    runScript("db-seed.ts", url);
    db = connect(url);
    await db.setting.update({ where: { id: 1 }, data: { search_terms: [SEARCH_TERM] } });

    const settings = createSettingsService(db);
    const companies = createCompanyService(db);
    const atsSlugs = createAtsSlugService(db);
    const jobService = createJobService(db);
    const trace = createTraceService(db);
    const priorityList = await settings.getSourcePriorityList();
    const identifyingQueryValues = await settings.getIdentifyingQueryValues();

    // Each employer the aggregator already attached its job to.
    const companyIds: Record<string, string> = {};
    for (const s of SYSTEMS) {
      const { company } = await companies.create({ name: s.employer });
      companyIds[s.name] = company.id;
    }

    // One job per system sits in the backlog, already followed to its
    // posting and waiting to be read. Each carries its id, the way collection
    // hands every job one before anything saves it.
    const saved = await saveJobs(
      SYSTEMS.map((s) => ({
        id: `job-${s.name}`,
        original_url: s.link,
        resolved_url: s.link,
        raw_title: READ_TITLE,
        raw_company_name: s.employer,
        company_id: companyIds[s.name],
        collector: "adzuna",
        collected_at: FIRST_RUN_AT,
        status: "backlog",
        is_resolved: true,
        is_parsed: false,
        is_classified: false,
      })),
      { jobService, priorityList, identifyingQueryValues }
    );
    if (saved.jobs.length !== SYSTEMS.length) {
      throw new Error(`the waiting jobs did not save: ${JSON.stringify(saved.warnings)}`);
    }

    globalThis.fetch = standIn(requests);

    const shared: Omit<RunJobSearchOptions, "collectors" | "collectedAt" | "runId"> = {
      settings,
      companies,
      atsSlugs,
      jobService,
      openBrowser: browserThatStaysPut(),
      waitForLoad: async () => {},
      places,
      geocoder: fakeGeocoder(),
      trace,
      log: () => {},
    };

    // The first run polls nothing. It only reads the waiting postings.
    await runJobSearch({ ...shared, collectors: [], collectedAt: FIRST_RUN_AT, runId: "run-read" });

    const boardsOf = (companyId: string | undefined) =>
      db.atsSlug.findMany({
        where: { company_id: companyId },
        select: { slug: true, parser: true, collector: true },
      });

    for (const s of SYSTEMS) {
      readJobs[s.name] = await db.job.findUnique({
        where: { id: `job-${s.name}` },
        select: { description: true, raw_location_list: true, raw_company_name: true, parser: true },
      });
      boardsAfterReading[s.name] = await boardsOf(companyIds[s.name]);
    }

    // Scoring rates every employer well above the promotion bar in every
    // category, which is what promotion acts on.
    const top = { score: 5, rationale: "Strong public record.", guessed: false };
    await runScoringSave({
      jobScores: [],
      companyScores: SYSTEMS.map((s) => ({
        id: companyIds[s.name] ?? "",
        scores: {
          employee_satisfaction: top,
          customer_satisfaction: top,
          work_life_balance: top,
          political_alignment: top,
        },
      })),
      settings,
      companies,
      jobService,
      atsSlugs,
      trace,
      runId: "run-score",
      scoredAt: SCORED_AT,
    });

    for (const s of SYSTEMS) {
      boardsAfterPromotion[s.name] = await boardsOf(companyIds[s.name]);
    }

    // The second run polls whatever the registry names as each system's
    // collector. Before this feature there are none, and nothing is polled.
    const names = new Set(SYSTEMS.map((s) => s.name));
    const firstRunRequestCount = requests.length;
    await runJobSearch({
      ...shared,
      collectors: COLLECTORS.filter((collector) => names.has(collector.name)),
      collectedAt: SECOND_RUN_AT,
      runId: "run-poll",
    });
    secondRunRequests = requests.slice(firstRunRequestCount).map((request) => new URL(request.url));

    for (const s of SYSTEMS) {
      const rows = await db.job.findMany({
        where: { collector: s.name },
        select: { resolved_url: true },
      });
      collectedLinks[s.name] = rows.map((row) => row.resolved_url ?? "");
    }
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  describe.each(SYSTEMS)("$name", (s) => {
    test("A posting fills the job's description", () => {
      expect(readJobs[s.name]?.description ?? "").toContain(s.description);
    });

    test("A posting fills the job's location", () => {
      expect(JSON.stringify(readJobs[s.name]?.raw_location_list ?? null)).toContain(s.city);
    });

    test("A posting fills the job's employer name", () => {
      // The name the job carries once its posting has been read by this
      // system's parser.
      expect(readJobs[s.name]?.parser).toBe(s.name);
      expect(readJobs[s.name]?.raw_company_name ?? "").not.toBe("");
    });

    test("A posting records the board in its link", () => {
      const boards = (boardsAfterReading[s.name] ?? []).map((row) => ({
        ...row,
        slug: row.slug.toLowerCase(),
      }));
      expect(boards).toContainEqual({ slug: s.board.toLowerCase(), parser: s.name, collector: null });
    });

    test("A high-scoring employer on the five systems is promoted", () => {
      expect(boardsAfterPromotion[s.name]?.map((row) => row.collector)).toEqual([s.name]);
    });

    test("A promoted board is polled", () => {
      expect(secondRunRequests.some((url) => s.isBoardListRequest(url))).toBe(true);
    });

    test("A collected job links to its posting", () => {
      const links = collectedLinks[s.name] ?? [];
      const toPolledJob = links.filter((link) => link.includes(s.polledJobMarker));
      expect(toPolledJob).toHaveLength(1);
      expect(new URL(toPolledJob[0] ?? "about:blank").host).toBe(s.postingHost);
    });
  });

  test("Tracking values do not stop a link being read", () => {
    for (const name of ["gem", "bamboohr", "rippling"]) {
      expect(system(name).link).toContain("utm_source");
      expect(readJobs[name]?.description ?? "").toContain(system(name).description);
    }
  });

  test("A trailing slash does not stop a link being read", () => {
    expect(system("workable").link.endsWith("/")).toBe(true);
    expect(readJobs["workable"]?.description ?? "").toContain(system("workable").description);
  });

  test("A SmartRecruiters link carrying the job title is read", () => {
    expect(readJobs["smartrecruiters"]?.description ?? "").toContain(
      system("smartrecruiters").description
    );
  });

  test("A Gem link with a numeric identifier is read", () => {
    expect(readJobs["gem"]?.description ?? "").toContain(system("gem").description);
  });
});
