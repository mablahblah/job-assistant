import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SettingsService } from "../services/settings-service";

// The collector reaches a live site in production, so every test here stubs
// the one function that does it. No request ever leaves the process.
vi.mock("../tools/fetch-page", () => ({
  fetchContainer: vi.fn(),
}));

// Writing a fixture is a filesystem side effect a unit test must never
// cause, so that one function is stubbed to a no-op returning no warnings.
// The rest of the module is pure and stays real, so the picking rule the
// collector relies on is exercised rather than faked.
vi.mock("./fixture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fixture")>()),
  writeFixture: vi.fn(() => []),
}));

import { uiuxjobsboardCollector } from "./uiuxjobsboard";
import { fetchContainer } from "../tools/fetch-page";
import { writeFixture } from "./fixture";
import { fakeSettingsService } from "../services/settings-service.fake";

// The site's six fixed categories, mirrored here so a test can address one
// by its path segment or its label without reaching into the collector's own
// unexported list.
const UI_DESIGNER = "ui-designer";
const UX_DESIGNER = "ux-designer";
const UI_UX_DESIGNER = "ui-ux-designer";
const PRODUCT_DESIGNER = "product-designer";
const UX_RESEARCHER = "ux-researcher";
const UX_WRITER = "ux-writer";

const PRODUCT_DESIGN_LABEL = "Product Design";
const UX_DESIGN_LABEL = "UX Design";

// One card, marked up the way the site's results page actually does it. The
// id drives the href, so a test can pick one job back out by url.
interface CardOptions {
  id?: number;
  title?: string;
  company?: string;
  age?: string;
}

let nextCardId = 0;

function uiuxCard(options: CardOptions = {}): string {
  const id = options.id ?? ++nextCardId;
  const title = options.title ?? `Role ${id}`;
  const age = options.age ?? "2d";
  const company = options.company ?? "Clera";
  const companyHtml =
    company === ""
      ? ""
      : `<span class="text-xl"><span>${company}<span class="text-base opacity-40 ml-1">is hiring</span></span></span>`;
  return `<div class="border shadow-xs rounded-xl bg-white overflow-hidden order-2">
    <div><h3><a class="inline-flex flex-col" href="/job/${id}-some-role">
      ${companyHtml}
      <span class="text-2xl text-primaryColor font-bold">${title}</span>
    </a></h3></div>
    <div class="text-sm">${age}</div>
  </div>`;
}

// A card the selector reaches but cannot read a title from. Enough of these
// on one page and the yield self-check fires.
function unreadableCard(id: number): string {
  return `<div class="border shadow-xs rounded-xl order-2">
    <div><h3><a class="inline-flex flex-col" href="/job/${id}-some-role"></a></h3></div>
    <div class="text-sm">2d</div>
  </div>`;
}

function uiuxResultsHtml(cards: string[]): string {
  return `<div class="max-w-225 flex flex-col mx-auto">${cards.join("")}</div>`;
}

// What one stubbed category page answers with: a results container holding
// these cards, or a request failure carrying this message.
interface CardsRoute {
  category: string;
  cards: string[];
  // The container is on the page but holds nothing, which is what a drifted
  // card selector looks like. Without this a cardless route stands for a
  // category the site renders no list for at all.
  emptyContainer?: boolean;
}

interface ThrowingRoute {
  category: string;
  throwMessage: string;
}

type Route = CardsRoute | ThrowingRoute;

function isThrowingRoute(route: Route): route is ThrowingRoute {
  return "throwMessage" in route;
}

function buildRoutes(routes: Route[]): Map<string, Route> {
  const map = new Map<string, Route>();
  for (const route of routes) map.set(route.category, route);
  return map;
}

// One category's route, holding these cards or none.
function categoryRoute(category: string, cards: string[]): Map<string, Route> {
  return buildRoutes([{ category, cards }]);
}

// Routes for several categories, every page returning the same cards.
function routesForCategories(categories: string[], cards: string[] = []): Map<string, Route> {
  return buildRoutes(categories.map((category) => ({ category, cards })));
}

// Answers each request from the routes, working out which category it is
// from the url path itself. A test never has to guess at fetch order.
function stubFetch(routes: Map<string, Route>): { urls: () => string[] } {
  const urls: string[] = [];

  vi.mocked(fetchContainer).mockImplementation(async (url: string) => {
    urls.push(url);
    const category = url.split("/").pop() ?? "";
    const route = routes.get(category);
    if (route === undefined) {
      throw new Error(`test bug: no route stubbed for ${url}`);
    }
    if (isThrowingRoute(route)) {
      throw new Error(route.throwMessage);
    }
    // A category page with nothing on it renders no list at all, which is
    // why an empty route answers with null rather than an empty container.
    return route.cards.length === 0 && route.emptyContainer !== true
      ? null
      : uiuxResultsHtml(route.cards);
  });

  return { urls: () => urls };
}

interface SettingsOverrides {
  searchTerms?: string[];
  expiryThreshold?: number;
}

const DEFAULT_SEARCH_TERMS = [PRODUCT_DESIGN_LABEL];
const DEFAULT_LOCATION = "Austin, TX";
const DEFAULT_EXPIRY_THRESHOLD = 30;

// A settings stand-in typed to the real interface, so a test overrides only
// the piece it cares about. Every method is a vi.fn, so call counts hold.
function makeSettings(overrides: SettingsOverrides = {}): SettingsService {
  return fakeSettingsService({
    getSearchTerms: vi.fn(async () => overrides.searchTerms ?? DEFAULT_SEARCH_TERMS),
    getLocation: vi.fn(async () => DEFAULT_LOCATION),
    getRadius: vi.fn(async () => 0),
    getExpiryThreshold: vi.fn(async () => overrides.expiryThreshold ?? DEFAULT_EXPIRY_THRESHOLD),
    getAtsCompanies: vi.fn(async () => []),
  });
}

async function collect(options: { settings?: SettingsService; limit?: number } = {}) {
  const settings = options.settings ?? makeSettings();
  return uiuxjobsboardCollector.collect({ settings, limit: options.limit ?? Infinity });
}

beforeEach(() => {
  nextCardId = 0;
  vi.mocked(fetchContainer).mockReset();
  vi.mocked(writeFixture).mockReset().mockReturnValue([]);
});

describe("the collector's name", () => {
  test("is uiuxjobsboard", () => {
    expect(uiuxjobsboardCollector.name).toBe("uiuxjobsboard");
  });
});

describe("a search term that matches one category fetches exactly that category's page", () => {
  test("Product Design fetches one page, at the product-designer url", async () => {
    const { urls } = stubFetch(routesForCategories([PRODUCT_DESIGNER]));

    await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(urls()).toHaveLength(1);
    expect(urls()[0].endsWith(`/${PRODUCT_DESIGNER}`)).toBe(true);
  });
});

describe("a search term that matches several categories fetches one page per matched category", () => {
  test("UX fetches UX Design, UI/UX Design, UX Research, and UX Writing", async () => {
    const matchedCategories = [UX_DESIGNER, UI_UX_DESIGNER, UX_RESEARCHER, UX_WRITER];
    const { urls } = stubFetch(routesForCategories(matchedCategories));

    await collect({ settings: makeSettings({ searchTerms: ["UX"] }) });

    expect(urls()).toHaveLength(4);
    for (const category of matchedCategories) {
      expect(urls().some((url) => url.endsWith(`/${category}`))).toBe(true);
    }
    // UI Design and Product Design carry no "ux" substring, so neither
    // category is among the fetched pages.
    expect(urls().some((url) => url.endsWith(`/${UI_DESIGNER}`))).toBe(false);
    expect(urls().some((url) => url.endsWith(`/${PRODUCT_DESIGNER}`))).toBe(false);
  });
});

describe("search terms matching no category fetch nothing", () => {
  test("no jobs and no errors come back, and fetchContainer is never called", async () => {
    stubFetch(new Map());

    const result = await collect({ settings: makeSettings({ searchTerms: ["Backend Engineer"] }) });

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(fetchContainer).not.toHaveBeenCalled();
  });

  test("exactly one warning says the search terms matched nothing", async () => {
    stubFetch(new Map());

    const result = await collect({ settings: makeSettings({ searchTerms: ["Backend Engineer"] }) });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("matched none of the site's categories");
  });
});

describe("settings are read once for the whole run, not once per category", () => {
  const matchedCategories = [UX_DESIGNER, UI_UX_DESIGNER, UX_RESEARCHER, UX_WRITER];

  test("getSearchTerms is called exactly once", async () => {
    const settings = makeSettings({ searchTerms: ["UX"] });
    stubFetch(routesForCategories(matchedCategories));

    await collect({ settings });

    expect(settings.getSearchTerms).toHaveBeenCalledTimes(1);
  });

  test("getExpiryThreshold is called exactly once", async () => {
    const settings = makeSettings({ searchTerms: ["UX"] });
    stubFetch(routesForCategories(matchedCategories));

    await collect({ settings });

    expect(settings.getExpiryThreshold).toHaveBeenCalledTimes(1);
  });
});

describe("getLocation is never called — the site has no location on these paths", () => {
  test("a normal run never reads it", async () => {
    const settings = makeSettings();
    stubFetch(routesForCategories([PRODUCT_DESIGNER]));

    await collect({ settings });

    expect(settings.getLocation).not.toHaveBeenCalled();
  });
});

describe("a card becomes a job carrying the fields a category page can supply", () => {
  test("original_url, raw_title, and a posting_date are all present", async () => {
    const card = uiuxCard({ id: 1, title: "Founding Product Designer", age: "2d" });
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [card]));

    const result = await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(result.jobs).toHaveLength(1);
    const [job] = result.jobs;
    expect(job.original_url).toBe("https://uiuxjobsboard.com/job/1-some-role");
    expect(job.raw_title).toBe("Founding Product Designer");
    expect(job.posting_date).toBeDefined();
  });

  test("the employer on the card becomes raw_company_name", async () => {
    const card = uiuxCard({ id: 1, company: "Toybox Labs" });
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [card]));

    const result = await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(result.jobs[0].raw_company_name).toBe("Toybox Labs");
  });

  test("a card naming no employer leaves raw_company_name off the job", async () => {
    // The job still travels this far. Dropping it is the orchestrator's call,
    // and it names the reason when it makes it.
    const card = uiuxCard({ id: 1, company: "" });
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [card]));

    const result = await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].raw_company_name).toBeUndefined();
  });

  test("no card collector writes a company slug, since neither site exposes one", async () => {
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [uiuxCard({ id: 1 })]));

    const result = await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(result.jobs[0].raw_company_slug).toBeUndefined();
  });

  test("posting_date is a Date, not the raw age text", async () => {
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [uiuxCard({ id: 1 })]));

    const result = await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(result.jobs[0].posting_date).toBeInstanceOf(Date);
  });

  test("the url is absolute and starts https://uiuxjobsboard.com/job/", async () => {
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [uiuxCard({ id: 7 })]));

    const result = await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(result.jobs[0].original_url?.startsWith("https://uiuxjobsboard.com/job/")).toBe(true);
  });

  test("is_resolved, is_parsed, and is_classified are all false", async () => {
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [uiuxCard()]));

    const result = await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    const [job] = result.jobs;
    expect(job.is_resolved).toBe(false);
    expect(job.is_parsed).toBe(false);
    expect(job.is_classified).toBe(false);
  });

  test("no location, work mode, or salary field is set — that is a parser's job", async () => {
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [uiuxCard()]));

    const result = await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    const [job] = result.jobs;
    expect(job.raw_location_list ?? []).toEqual([]);
    expect(job.raw_mode_list ?? []).toEqual([]);
    expect(job.raw_salary).toBeUndefined();
    expect(job.salary_low).toBeUndefined();
    expect(job.salary_high).toBeUndefined();
    expect(job.salary_period).toBeUndefined();
  });
});

describe("a card at or past the expiry threshold is dropped and stops that category's search", () => {
  test("a card under the threshold is kept while cards at and past it are not", async () => {
    stubFetch(
      categoryRoute(PRODUCT_DESIGNER, [
        uiuxCard({ id: 1, age: "5d" }),
        uiuxCard({ id: 2, age: "30d" }),
        uiuxCard({ id: 3, age: "40d" }),
      ])
    );

    const result = await collect({
      settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL], expiryThreshold: 30 }),
    });

    const urls = result.jobs.map((job) => job.original_url);
    expect(urls).toContain("https://uiuxjobsboard.com/job/1-some-role");
    expect(urls).not.toContain("https://uiuxjobsboard.com/job/2-some-role");
    expect(urls).not.toContain("https://uiuxjobsboard.com/job/3-some-role");
  });
});

describe("a category page whose fetch fails is degraded, not fatal", () => {
  function failingRoutes(): Map<string, Route> {
    return buildRoutes([
      { category: UX_DESIGNER, throwMessage: "ECONNRESET" },
      { category: UI_UX_DESIGNER, cards: [uiuxCard({ id: 9 })] },
      { category: UX_RESEARCHER, cards: [] },
      { category: UX_WRITER, cards: [] },
    ]);
  }

  test("a warning names the category that failed", async () => {
    stubFetch(failingRoutes());

    const result = await collect({ settings: makeSettings({ searchTerms: ["UX"] }) });

    expect(result.warnings.some((warning) => warning.includes(UX_DESIGN_LABEL))).toBe(true);
  });

  test("the warning carries the reason the request gave", async () => {
    stubFetch(failingRoutes());

    const result = await collect({ settings: makeSettings({ searchTerms: ["UX"] }) });

    expect(result.warnings.some((warning) => warning.includes("ECONNRESET"))).toBe(true);
  });

  test("the remaining categories still run and still return their jobs", async () => {
    stubFetch(failingRoutes());

    const result = await collect({ settings: makeSettings({ searchTerms: ["UX"] }) });

    expect(result.jobs.some((job) => job.original_url === "https://uiuxjobsboard.com/job/9-some-role")).toBe(true);
  });

  test("collect resolves rather than rejecting", async () => {
    stubFetch(failingRoutes());

    await expect(collect({ settings: makeSettings({ searchTerms: ["UX"] }) })).resolves.toBeDefined();
  });

  test("errors is empty — one dead category is a degraded run, not a failed collector", async () => {
    stubFetch(failingRoutes());

    const result = await collect({ settings: makeSettings({ searchTerms: ["UX"] }) });

    expect(result.errors).toEqual([]);
  });
});

describe("a category page that renders no list at all", () => {
  // The live site drops the list entirely rather than showing an empty one,
  // so reading it must come back empty instead of throwing.

  test("no jobs come back and the collector does not fail", async () => {
    stubFetch(categoryRoute(PRODUCT_DESIGNER, []));

    const result = await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // Every category this collector read came back empty, which is what a
  // broken card selector looks like, so it says so once rather than per
  // category.
  test("the warning says no cards were found anywhere", async () => {
    stubFetch(categoryRoute(PRODUCT_DESIGNER, []));

    const result = await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    const noCards = result.warnings.filter((warning) => warning.includes("no result cards"));
    expect(noCards).toHaveLength(1);
    expect(noCards[0]).toContain("selector");
  });
});

describe("limit caps jobs across every category combined, not per category", () => {
  test("a limit of 3 with 8 cards on offer across four categories yields exactly 3 jobs", async () => {
    stubFetch(
      buildRoutes([
        { category: UX_DESIGNER, cards: [uiuxCard({ id: 1 }), uiuxCard({ id: 2 })] },
        { category: UI_UX_DESIGNER, cards: [uiuxCard({ id: 3 }), uiuxCard({ id: 4 })] },
        { category: UX_RESEARCHER, cards: [uiuxCard({ id: 5 }), uiuxCard({ id: 6 })] },
        { category: UX_WRITER, cards: [uiuxCard({ id: 7 }), uiuxCard({ id: 8 })] },
      ])
    );

    const result = await collect({ settings: makeSettings({ searchTerms: ["UX"] }), limit: 3 });

    expect(result.jobs).toHaveLength(3);
  });
});

describe("the fixture is refreshed once for the whole run, keyed to one category", () => {
  test("a clean search calls writeFixture once with selfCheckFailed false", async () => {
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [uiuxCard({ id: 1 })]));

    await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(writeFixture).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeFixture).mock.calls[0][2]).toEqual({ selfCheckFailed: false });
  });

  test("the fixture is saved under the collector's own name", async () => {
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [uiuxCard({ id: 1 })]));

    await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(vi.mocked(writeFixture).mock.calls[0][0]).toBe("uiuxjobsboard");
  });

  test("the saved html is a results container holding cards", async () => {
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [uiuxCard({ id: 1 })]));

    await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    const savedHtml = vi.mocked(writeFixture).mock.calls[0][1];
    expect(savedHtml).toContain("max-w-225");
    expect(savedHtml).toContain("shadow-xs rounded-xl");
  });

  test("a category that legitimately matches nothing does not block the write", async () => {
    // Only the second of four matched categories holds any cards. The empty
    // ones on either side must not stop that one from being saved.
    stubFetch(
      buildRoutes([
        { category: UX_DESIGNER, cards: [] },
        { category: UI_UX_DESIGNER, cards: [uiuxCard({ id: 1 })] },
        { category: UX_RESEARCHER, cards: [] },
        { category: UX_WRITER, cards: [] },
      ])
    );

    await collect({ settings: makeSettings({ searchTerms: ["UX"] }) });

    expect(vi.mocked(writeFixture).mock.calls[0][1]).toContain("shadow-xs rounded-xl");
    expect(vi.mocked(writeFixture).mock.calls[0][2]).toEqual({ selfCheckFailed: false });
  });

  test("a later category whose list is present but empty does not claim the page", async () => {
    // An empty list is a drifted selector, not a page worth saving. The good
    // page from the category before it is what gets written.
    stubFetch(
      buildRoutes([
        { category: UX_DESIGNER, cards: [uiuxCard({ id: 1 })] },
        { category: UI_UX_DESIGNER, cards: [], emptyContainer: true },
        { category: UX_RESEARCHER, cards: [] },
        { category: UX_WRITER, cards: [] },
      ])
    );

    await collect({ settings: makeSettings({ searchTerms: ["UX"] }) });

    expect(vi.mocked(writeFixture).mock.calls[0][1]).toContain("shadow-xs rounded-xl");
    expect(vi.mocked(writeFixture).mock.calls[0][2]).toEqual({ selfCheckFailed: false });
  });

  test("the richest category is saved, not the last one that had cards", async () => {
    // The last category to return anything can be a thin one. Saving that
    // leaves a baseline proving almost nothing about the markup.
    stubFetch(
      buildRoutes([
        { category: UX_DESIGNER, cards: [uiuxCard({ id: 1 }), uiuxCard({ id: 2 }), uiuxCard({ id: 3 })] },
        { category: UI_UX_DESIGNER, cards: [uiuxCard({ id: 9 })] },
        { category: UX_RESEARCHER, cards: [] },
        { category: UX_WRITER, cards: [] },
      ])
    );

    await collect({ settings: makeSettings({ searchTerms: ["UX"] }) });

    const savedHtml = vi.mocked(writeFixture).mock.calls[0][1];
    expect(savedHtml).toContain("/job/1-some-role");
    expect(savedHtml).not.toContain("/job/9-some-role");
  });

  test("a poor yield in the category being saved does block the write", async () => {
    const degraded = [uiuxCard({ id: 1 }), unreadableCard(2), unreadableCard(3), unreadableCard(4)];
    stubFetch(categoryRoute(PRODUCT_DESIGNER, degraded));

    await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(vi.mocked(writeFixture).mock.calls[0][2]).toEqual({ selfCheckFailed: true });
  });

  test("warnings writeFixture returns are passed through into the collector's own", async () => {
    const fixtureWarning = "uiuxjobsboard: fixture left alone — refusing to overwrite it with empty html";
    vi.mocked(writeFixture).mockReturnValue([fixtureWarning]);
    stubFetch(categoryRoute(PRODUCT_DESIGNER, [uiuxCard({ id: 1 })]));

    const result = await collect({ settings: makeSettings({ searchTerms: [PRODUCT_DESIGN_LABEL] }) });

    expect(result.warnings).toContain(fixtureWarning);
  });
});
