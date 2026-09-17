import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  MissingSearchCredentialError,
  SEARCH_TIME_LIMIT_SECONDS,
  createCompanySearch,
  type ActorRunner,
} from "./company-search";

// The real client sends its requests through axios rather than fetch, so a
// test cannot intercept them by stubbing the global. The tool therefore takes
// the call it makes as an argument, the way the resolution browser takes its
// launcher, and every test here hands it one of its own. Criterion 85.
const TOKEN = "APIFY_API_TOKEN";

let previousToken: string | undefined;

beforeEach(() => {
  previousToken = process.env[TOKEN];
  process.env[TOKEN] = "a-token";
});

afterEach(() => {
  if (previousToken === undefined) delete process.env[TOKEN];
  else process.env[TOKEN] = previousToken;
  vi.useRealTimers();
});

function runnerReturning(items: unknown[]): ActorRunner {
  return async () => items;
}

// Criterion 44. What a search asked about is observable here, which is what
// the stand-in replaces in a handler's own tests.
describe("asking the search service", () => {
  test("the query reaches the service", async () => {
    const asked: string[] = [];
    const search = createCompanySearch(async (query) => {
      asked.push(query);
      return [];
    });

    await search.search("Figma headquarters address, phone number, domain url");

    expect(asked).toEqual(["Figma headquarters address, phone number, domain url"]);
  });

  test("a result's title and its text come back", async () => {
    const search = createCompanySearch(
      runnerReturning([
        { title: "Figma Inc.", snippet: "760 Market Street, San Francisco, CA 94102", link: "x" },
      ])
    );

    expect(await search.search("Figma")).toEqual([
      { title: "Figma Inc.", text: "760 Market Street, San Francisco, CA 94102" },
    ]);
  });

  test("every result comes back, in the order the service returned them", async () => {
    const search = createCompanySearch(
      runnerReturning([
        { title: "First", snippet: "one" },
        { title: "Second", snippet: "two" },
      ])
    );

    expect((await search.search("Figma")).map((result) => result.title)).toEqual([
      "First",
      "Second",
    ]);
  });

  test("a search that found nothing comes back empty", async () => {
    const search = createCompanySearch(runnerReturning([]));

    expect(await search.search("Nobody At All")).toEqual([]);
  });

  // The old code cast the response without checking it. Measured against the
  // live service every item carried a title and a snippet, but a service that
  // changes shape must not put undefined onto a legal filing.
  test("an item missing its title or its text reads as empty rather than undefined", async () => {
    const search = createCompanySearch(runnerReturning([{}, { title: 5, snippet: null }]));

    expect(await search.search("Figma")).toEqual([
      { title: "", text: "" },
      { title: "", text: "" },
    ]);
  });
});

// Criterion 56. Read at call time rather than at construction, so a tool built
// before the environment is loaded still works.
describe("no access credential", () => {
  test("the search is refused with an error naming the credential", async () => {
    delete process.env[TOKEN];
    const search = createCompanySearch(runnerReturning([]));

    await expect(search.search("Figma")).rejects.toBeInstanceOf(MissingSearchCredentialError);
  });

  test("an empty credential is the same as none", async () => {
    process.env[TOKEN] = "";
    const search = createCompanySearch(runnerReturning([]));

    await expect(search.search("Figma")).rejects.toBeInstanceOf(MissingSearchCredentialError);
  });

  test("the service is never asked when there is no credential", async () => {
    delete process.env[TOKEN];
    const asked: string[] = [];
    const search = createCompanySearch(async (query) => {
      asked.push(query);
      return [];
    });

    await expect(search.search("Figma")).rejects.toThrow();

    expect(asked).toEqual([]);
  });
});

// Criterion 65. The limit is handed to the service as well as held here, so
// it stops the run being paid for rather than only our waiting on it.
describe("the time limit", () => {
  test("the limit travels to the service", async () => {
    const limits: number[] = [];
    const search = createCompanySearch(async (_query, limitSeconds) => {
      limits.push(limitSeconds);
      return [];
    });

    await search.search("Figma");

    expect(limits).toEqual([SEARCH_TIME_LIMIT_SECONDS]);
  });

  test("a search that never answers stops at the limit", async () => {
    vi.useFakeTimers();
    const search = createCompanySearch(() => new Promise<unknown[]>(() => {}));

    const pending = search.search("Figma");
    const settled = expect(pending).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(SEARCH_TIME_LIMIT_SECONDS * 1000 + 1000);

    await settled;
  });

  test("a search that answers inside the limit is not cut off", async () => {
    const search = createCompanySearch(runnerReturning([{ title: "Figma", snippet: "here" }]));

    expect(await search.search("Figma")).toHaveLength(1);
  });
});

describe("a service that errors", () => {
  test("the error reaches the caller", async () => {
    const search = createCompanySearch(async () => {
      throw new Error("the service is down");
    });

    await expect(search.search("Figma")).rejects.toThrow("the service is down");
  });
});
