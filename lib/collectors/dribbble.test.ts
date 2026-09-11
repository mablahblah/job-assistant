import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SettingsService } from "../settings-service";

// The collector reaches a live site in production, so every test here stubs
// the one function that does it. No request ever leaves the process.
vi.mock("./fetch-page", () => ({
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

import { dribbbleCollector } from "./dribbble";
import { fetchContainer } from "./fetch-page";
import { writeFixture } from "./fixture";
import { fakeSettingsService } from "../settings-service.fake";

type SearchMode = "location" | "remote";

// One card, marked up the way Dribbble's results list actually does it. The
// id drives the href, so a test can pick one job back out by url.
interface CardOptions {
  id?: number;
  title?: string;
  company?: string;
  age?: string;
}

let nextCardId = 0;

function dribbbleCard(options: CardOptions = {}): string {
  const id = options.id ?? ++nextCardId;
  const title = options.title ?? `Role ${id}`;
  const age = options.age ?? "Posted 2 days ago";
  const company = options.company ?? "Vantheon";
  const companyHtml =
    company === "" ? "" : `<span class="job-board-job-company">${company}</span>`;
  return `<li class="job-list-item ">
    <a class="job-link" rel="nofollow" href="/jobs/${id}-Some-Role?source=index"></a>
    <div class="job-title-company-container">${companyHtml}<h4 class="job-title job-board-job-title">${title}</h4></div>
    <div class="job-details"><div class="posted-on hide-on-mobile">${age}</div></div>
  </li>`;
}

// A card the selector reaches but cannot read a title from. Enough of these
// on one page and the yield self-check fires.
function unreadableCard(id: number): string {
  return `<li class="job-list-item ">
    <a class="job-link" rel="nofollow" href="/jobs/${id}-Some-Role?source=index"></a>
    <div class="job-details"><div class="posted-on hide-on-mobile">Posted 2 days ago</div></div>
  </li>`;
}

function dribbbleResultsHtml(cards: string[]): string {
  return `<ol class="job-board-job-list">${cards.join("")}</ol>`;
}

// What one stubbed search answers with: a results list holding these cards,
// or a request failure carrying this message.
interface CardsRoute {
  term: string;
  mode: SearchMode;
  cards: string[];
  // The list element is on the page but holds nothing, which is what a
  // drifted card selector looks like. Without this a cardless route stands
  // for a search that simply matched nothing, and renders no list at all.
  emptyContainer?: boolean;
}

interface ThrowingRoute {
  term: string;
  mode: SearchMode;
  throwMessage: string;
}

type Route = CardsRoute | ThrowingRoute;

function isThrowingRoute(route: Route): route is ThrowingRoute {
  return "throwMessage" in route;
}

function routeKey(term: string, mode: SearchMode): string {
  return `${term}::${mode}`;
}

function buildRoutes(routes: Route[]): Map<string, Route> {
  const map = new Map<string, Route>();
  for (const route of routes) map.set(routeKey(route.term, route.mode), route);
  return map;
}

// The routes for one term run both ways, which is what every real term does.
function singleTermRoutes(
  term: string,
  locationCards: string[],
  remoteCards: string[]
): Map<string, Route> {
  return buildRoutes([
    { term, mode: "location" as const, cards: locationCards },
    { term, mode: "remote" as const, cards: remoteCards },
  ]);
}

// Routes for several terms, every search returning the same cards.
function routesForTerms(terms: string[], cards: string[] = []): Map<string, Route> {
  return buildRoutes(
    terms.flatMap((term) => [
      { term, mode: "location" as const, cards },
      { term, mode: "remote" as const, cards },
    ])
  );
}

// Answers each request from the routes, working out which search it is from
// the url itself. A test never has to guess at param order or at how a space
// was encoded.
function stubFetch(routes: Map<string, Route>): { urls: () => string[] } {
  const urls: string[] = [];

  vi.mocked(fetchContainer).mockImplementation(async (url: string) => {
    urls.push(url);
    const parsed = new URL(url);
    const term = parsed.searchParams.get("keyword") ?? "";
    const mode: SearchMode = parsed.searchParams.has("anywhere") ? "remote" : "location";
    const route = routes.get(routeKey(term, mode));
    if (route === undefined) {
      throw new Error(`test bug: no route stubbed for ${url}`);
    }
    if (isThrowingRoute(route)) {
      throw new Error(route.throwMessage);
    }
    // A search that matched nothing renders no results list at all, which is
    // why an empty route answers with null rather than an empty list.
    return route.cards.length === 0 && route.emptyContainer !== true
      ? null
      : dribbbleResultsHtml(route.cards);
  });

  return { urls: () => urls };
}

interface SettingsOverrides {
  searchTerms?: string[];
  location?: string;
  expiryThreshold?: number;
}

const DEFAULT_SEARCH_TERMS = ["Product Design"];
const DEFAULT_LOCATION = "Austin, TX";
const DEFAULT_EXPIRY_THRESHOLD = 30;

// A settings stand-in typed to the real interface, so a test overrides only
// the piece it cares about. Every method is a vi.fn, so call counts hold.
function makeSettings(overrides: SettingsOverrides = {}): SettingsService {
  return fakeSettingsService({
    getSearchTerms: vi.fn(async () => overrides.searchTerms ?? DEFAULT_SEARCH_TERMS),
    getLocation: vi.fn(async () => overrides.location ?? DEFAULT_LOCATION),
    getRadius: vi.fn(async () => 0),
    getExpiryThreshold: vi.fn(async () => overrides.expiryThreshold ?? DEFAULT_EXPIRY_THRESHOLD),
    getAtsCompanies: vi.fn(async () => []),
  });
}

async function collect(options: { settings?: SettingsService; limit?: number } = {}) {
  const settings = options.settings ?? makeSettings();
  return dribbbleCollector.collect({ settings, limit: options.limit ?? Infinity });
}

beforeEach(() => {
  nextCardId = 0;
  vi.mocked(fetchContainer).mockReset();
  vi.mocked(writeFixture).mockReset().mockReturnValue([]);
});

describe("the collector's name", () => {
  test("is dribbble", () => {
    expect(dribbbleCollector.name).toBe("dribbble");
  });
});

describe("every search term runs both a location search and a remote search", () => {
  test("three search terms produce six requests", async () => {
    const terms = ["Product Design", "UX Designer", "UI Designer"];
    const { urls } = stubFetch(routesForTerms(terms));

    await collect({ settings: makeSettings({ searchTerms: terms }) });

    expect(urls()).toHaveLength(6);
  });
});

describe("the search term reaches the query string url-encoded", () => {
  test("a term with a space carries no literal space in the url", async () => {
    const term = "Product Design";
    const { urls } = stubFetch(singleTermRoutes(term, [], []));

    await collect({ settings: makeSettings({ searchTerms: [term] }) });

    for (const url of urls()) {
      expect(url).not.toContain(" ");
    }
  });

  test("the encoded keyword decodes back to the original term", async () => {
    const term = "Product Design";
    const { urls } = stubFetch(singleTermRoutes(term, [], []));

    await collect({ settings: makeSettings({ searchTerms: [term] }) });

    for (const url of urls()) {
      expect(new URL(url).searchParams.get("keyword")).toBe(term);
    }
  });
});

describe("one search per term is anchored to the settings location, the other to anywhere", () => {
  test("one request carries the location exactly as settings gave it", async () => {
    const term = "Product Design";
    const location = "Austin, TX";
    const { urls } = stubFetch(singleTermRoutes(term, [], []));

    await collect({ settings: makeSettings({ searchTerms: [term], location }) });

    expect(urls().find((url) => new URL(url).searchParams.get("location") === location)).toBeDefined();
  });

  test("the other carries anywhere=true and no location", async () => {
    const term = "Product Design";
    const { urls } = stubFetch(singleTermRoutes(term, [], []));

    await collect({ settings: makeSettings({ searchTerms: [term] }) });

    const remote = urls().find((url) => new URL(url).searchParams.get("anywhere") === "true");
    expect(remote).toBeDefined();
    expect(new URL(remote as string).searchParams.has("location")).toBe(false);
  });
});

describe("settings are read once for the whole run, not once per search", () => {
  const terms = ["Product Design", "UX Designer"];

  test("getSearchTerms is called exactly once", async () => {
    const settings = makeSettings({ searchTerms: terms });
    stubFetch(routesForTerms(terms));

    await collect({ settings });

    expect(settings.getSearchTerms).toHaveBeenCalledTimes(1);
  });

  test("getLocation is called exactly once", async () => {
    const settings = makeSettings({ searchTerms: terms });
    stubFetch(routesForTerms(terms));

    await collect({ settings });

    expect(settings.getLocation).toHaveBeenCalledTimes(1);
  });

  test("getExpiryThreshold is called exactly once, not once per search", async () => {
    const settings = makeSettings({ searchTerms: terms });
    stubFetch(routesForTerms(terms));

    await collect({ settings });

    expect(settings.getExpiryThreshold).toHaveBeenCalledTimes(1);
  });
});

describe("a card becomes a job carrying the fields an aggregator link can supply", () => {
  test("original_url, raw_title, and a posting_date are all present", async () => {
    const term = "Product Design";
    const card = dribbbleCard({ id: 1, title: "Founding Product Designer", age: "Posted 2 days ago" });
    stubFetch(singleTermRoutes(term, [card], []));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(result.jobs).toHaveLength(1);
    const [job] = result.jobs;
    expect(job.original_url).toBe("https://dribbble.com/jobs/1-Some-Role");
    expect(job.raw_title).toBe("Founding Product Designer");
    expect(job.posting_date).toBeDefined();
  });

  test("the employer on the card becomes raw_company_name", async () => {
    const term = "Product Design";
    const card = dribbbleCard({ id: 1, company: "Toybox Labs" });
    stubFetch(singleTermRoutes(term, [card], []));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(result.jobs[0].raw_company_name).toBe("Toybox Labs");
  });

  test("a card naming no employer leaves raw_company_name off the job", async () => {
    // The job still travels this far. Dropping it is the orchestrator's call,
    // and it names the reason when it makes it.
    const term = "Product Design";
    const card = dribbbleCard({ id: 1, company: "" });
    stubFetch(singleTermRoutes(term, [card], []));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].raw_company_name).toBeUndefined();
  });

  test("no card collector writes a company slug, since neither site exposes one", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [dribbbleCard({ id: 1 })], []));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(result.jobs[0].raw_company_slug).toBeUndefined();
  });

  test("posting_date is a Date, not the raw age text", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [dribbbleCard({ id: 1 })], []));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(result.jobs[0].posting_date).toBeInstanceOf(Date);
  });

  test("an older card lands on an earlier posting_date than a fresher one", async () => {
    const term = "Product Design";
    const fresh = dribbbleCard({ id: 1, age: "Posted 1 day ago" });
    const older = dribbbleCard({ id: 2, age: "Posted 5 days ago" });
    stubFetch(singleTermRoutes(term, [fresh, older], []));

    const result = await collect({
      settings: makeSettings({ searchTerms: [term], expiryThreshold: 30 }),
    });

    const freshJob = result.jobs.find((job) => job.original_url === "https://dribbble.com/jobs/1-Some-Role");
    const olderJob = result.jobs.find((job) => job.original_url === "https://dribbble.com/jobs/2-Some-Role");
    expect(olderJob?.posting_date?.getTime()).toBeLessThan(freshJob?.posting_date?.getTime() as number);
  });

  // AC 57, 58, 59. Dribbble hosts its own postings, so there is nowhere for
  // resolution to walk to. Three of its listings were measured sharing one
  // "View job" link, so walking them would hand three distinct jobs one
  // resolved URL and dedupe would read that as proof they are one job.
  test("is_resolved is true, because Dribbble hosts the posting itself", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [dribbbleCard()], []));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    const [job] = result.jobs;
    expect(job.is_resolved).toBe(true);
  });

  test("resolved_url equals original_url", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [dribbbleCard()], []));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    const [job] = result.jobs;
    expect(job.resolved_url).toBe(job.original_url);
  });

  test("is_parsed and is_classified are still false", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [dribbbleCard()], []));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    const [job] = result.jobs;
    expect(job.is_parsed).toBe(false);
    expect(job.is_classified).toBe(false);
  });

  test("no location, work mode, or salary field is set — that is a parser's job", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [dribbbleCard()], []));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    const [job] = result.jobs;
    expect(job.raw_location_list ?? []).toEqual([]);
    expect(job.raw_mode_list ?? []).toEqual([]);
    expect(job.raw_salary).toBeUndefined();
    expect(job.salary_low).toBeUndefined();
    expect(job.salary_high).toBeUndefined();
    expect(job.salary_period).toBeUndefined();
  });
});

describe("a card past the expiry threshold is dropped and stops that search", () => {
  test("a card under the threshold is kept while cards at and past it are not", async () => {
    const term = "Product Design";
    stubFetch(
      singleTermRoutes(
        term,
        [
          dribbbleCard({ id: 1, age: "Posted 5 days ago" }),
          dribbbleCard({ id: 2, age: "Posted 30 days ago" }),
          dribbbleCard({ id: 3, age: "Posted 40 days ago" }),
        ],
        []
      )
    );

    const result = await collect({
      settings: makeSettings({ searchTerms: [term], expiryThreshold: 30 }),
    });

    const urls = result.jobs.map((job) => job.original_url);
    expect(urls).toContain("https://dribbble.com/jobs/1-Some-Role");
    expect(urls).not.toContain("https://dribbble.com/jobs/2-Some-Role");
    expect(urls).not.toContain("https://dribbble.com/jobs/3-Some-Role");
  });
});

describe("a search whose request fails is degraded, not fatal", () => {
  const failingRoutes = buildRoutes([
    { term: "Product Design", mode: "location", throwMessage: "ECONNRESET" },
    { term: "Product Design", mode: "remote", cards: [] },
  ]);

  test("a warning names the search that failed", async () => {
    stubFetch(failingRoutes);

    const result = await collect({ settings: makeSettings({ searchTerms: ["Product Design"] }) });

    expect(result.warnings.some((warning) => warning.includes("Product Design"))).toBe(true);
  });

  test("the warning carries the reason the request gave", async () => {
    stubFetch(failingRoutes);

    const result = await collect({ settings: makeSettings({ searchTerms: ["Product Design"] }) });

    expect(result.warnings.some((warning) => warning.includes("ECONNRESET"))).toBe(true);
  });

  test("the remaining searches still run and still return their jobs", async () => {
    stubFetch(
      buildRoutes([
        { term: "Product Design", mode: "location", throwMessage: "ECONNRESET" },
        { term: "Product Design", mode: "remote", cards: [] },
        { term: "UX Designer", mode: "location", cards: [dribbbleCard({ id: 9 })] },
        { term: "UX Designer", mode: "remote", cards: [] },
      ])
    );

    const result = await collect({
      settings: makeSettings({ searchTerms: ["Product Design", "UX Designer"] }),
    });

    expect(result.jobs.some((job) => job.original_url === "https://dribbble.com/jobs/9-Some-Role")).toBe(true);
  });

  test("collect resolves rather than rejecting", async () => {
    stubFetch(failingRoutes);

    await expect(
      collect({ settings: makeSettings({ searchTerms: ["Product Design"] }) })
    ).resolves.toBeDefined();
  });

  test("errors is empty — one dead search is a degraded run, not a failed collector", async () => {
    stubFetch(failingRoutes);

    const result = await collect({ settings: makeSettings({ searchTerms: ["Product Design"] }) });

    expect(result.errors).toEqual([]);
  });
});

describe("a search that matched nothing renders no results list", () => {
  // The live site drops the list entirely rather than showing an empty one,
  // so reading it must come back empty instead of throwing.

  test("no jobs come back and the collector does not fail", async () => {
    const term = "Founding Design";
    stubFetch(singleTermRoutes(term, [], []));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // Every search this collector ran came back empty, which is what a broken
  // card selector looks like, so it says so once rather than per search.
  test("the warning says no cards were found anywhere", async () => {
    const term = "Founding Design";
    stubFetch(singleTermRoutes(term, [], []));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    const noCards = result.warnings.filter((warning) => warning.includes("no result cards"));
    expect(noCards).toHaveLength(1);
    expect(noCards[0]).toContain("selector");
  });
});

// Dribbble anchors one search of each pair to the user's location. A site
// with no jobs in that place is ordinary, and warning about it every run
// would train the reader to skip the line the one time it matters.
describe("a search that finds nothing beside one that finds cards", () => {
  test("raises no no-cards warning at all", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [], [dribbbleCard({ id: 1 })]));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.filter((warning) => warning.includes("no result cards"))).toEqual([]);
  });
});

describe("limit caps jobs across every search combined, not per search", () => {
  test("a limit of 3 with 8 cards on offer across four searches yields exactly 3 jobs", async () => {
    stubFetch(
      buildRoutes([
        { term: "Product Design", mode: "location", cards: [dribbbleCard({ id: 1 }), dribbbleCard({ id: 2 })] },
        { term: "Product Design", mode: "remote", cards: [dribbbleCard({ id: 3 }), dribbbleCard({ id: 4 })] },
        { term: "UX Designer", mode: "location", cards: [dribbbleCard({ id: 5 }), dribbbleCard({ id: 6 })] },
        { term: "UX Designer", mode: "remote", cards: [dribbbleCard({ id: 7 }), dribbbleCard({ id: 8 })] },
      ])
    );

    const result = await collect({
      settings: makeSettings({ searchTerms: ["Product Design", "UX Designer"] }),
      limit: 3,
    });

    expect(result.jobs).toHaveLength(3);
  });
});

describe("the fixture is refreshed once for the whole run, keyed to one search", () => {
  test("a clean search calls writeFixture once with selfCheckFailed false", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [dribbbleCard({ id: 1 })], [dribbbleCard({ id: 2 })]));

    await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(writeFixture).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeFixture).mock.calls[0][2]).toEqual({ selfCheckFailed: false });
  });

  test("the fixture is saved under the collector's own name", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [dribbbleCard({ id: 1 })], [dribbbleCard({ id: 2 })]));

    await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(vi.mocked(writeFixture).mock.calls[0][0]).toBe("dribbble");
  });

  test("the saved html is a results list holding cards", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [dribbbleCard({ id: 1 })], [dribbbleCard({ id: 2 })]));

    await collect({ settings: makeSettings({ searchTerms: [term] }) });

    const savedHtml = vi.mocked(writeFixture).mock.calls[0][1];
    expect(savedHtml).toContain("job-board-job-list");
    expect(savedHtml).toContain("job-list-item");
  });

  test("a later empty search does not replace the list that held cards", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [dribbbleCard({ id: 1 })], []));

    await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(vi.mocked(writeFixture).mock.calls[0][1]).toContain("job-list-item");
  });

  test("a later search whose list is present but empty does not claim the page", async () => {
    stubFetch(
      buildRoutes([
        { term: "Product Design", mode: "location", cards: [dribbbleCard({ id: 1 })] },
        { term: "Product Design", mode: "remote", cards: [], emptyContainer: true },
      ])
    );

    await collect({ settings: makeSettings({ searchTerms: ["Product Design"] }) });

    expect(vi.mocked(writeFixture).mock.calls[0][1]).toContain("job-list-item");
    expect(vi.mocked(writeFixture).mock.calls[0][2]).toEqual({ selfCheckFailed: false });
  });

  test("a term that legitimately matches nothing does not block the write", async () => {
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [], [dribbbleCard()]));

    await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(vi.mocked(writeFixture).mock.calls[0][2]).toEqual({ selfCheckFailed: false });
  });

  test("the richest search is saved, not the last one that had cards", async () => {
    // Six searches run per term, and the last to return anything is often a
    // one-result location search. Saving that leaves a baseline proving
    // almost nothing about the markup.
    const term = "Product Design";
    const rich = [dribbbleCard({ id: 1 }), dribbbleCard({ id: 2 }), dribbbleCard({ id: 3 })];
    stubFetch(singleTermRoutes(term, rich, [dribbbleCard({ id: 9 })]));

    await collect({ settings: makeSettings({ searchTerms: [term] }) });

    const savedHtml = vi.mocked(writeFixture).mock.calls[0][1];
    expect(savedHtml).toContain("/jobs/1-Some-Role");
    expect(savedHtml).not.toContain("/jobs/9-Some-Role");
  });

  test("a poor yield in the search being copied does block the write", async () => {
    const term = "Product Design";
    const degraded = [dribbbleCard({ id: 1 }), unreadableCard(2), unreadableCard(3), unreadableCard(4)];
    stubFetch(singleTermRoutes(term, [], degraded));

    await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(vi.mocked(writeFixture).mock.calls[0][2]).toEqual({ selfCheckFailed: true });
  });

  test("warnings writeFixture returns are passed through into the collector's own", async () => {
    const fixtureWarning = "dribbble: fixture left alone — refusing to overwrite it with empty html";
    vi.mocked(writeFixture).mockReturnValue([fixtureWarning]);
    const term = "Product Design";
    stubFetch(singleTermRoutes(term, [dribbbleCard({ id: 1 })], [dribbbleCard({ id: 2 })]));

    const result = await collect({ settings: makeSettings({ searchTerms: [term] }) });

    expect(result.warnings).toContain(fixtureWarning);
  });
});
