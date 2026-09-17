import { describe, expect, test, vi } from "vitest";
import { MissingSearchCredentialError } from "./company-search";
import { NEVER_ANSWERS, fakeCompanySearch } from "./company-search.fake";

describe("the fake search service", () => {
  test("answers from its table", async () => {
    const search = fakeCompanySearch({
      "Figma headquarters": [{ title: "Figma Inc.", text: "760 Market Street" }],
    });

    expect(await search.search("Figma headquarters")).toEqual([
      { title: "Figma Inc.", text: "760 Market Street" },
    ]);
  });

  test("a query the table says nothing about answers empty", async () => {
    const search = fakeCompanySearch({});

    expect(await search.search("Nobody At All")).toEqual([]);
  });

  test("every query it was asked is recorded, in order", async () => {
    const search = fakeCompanySearch({});

    await search.search("First Co");
    await search.search("Second Co");

    expect(search.asked).toEqual(["First Co", "Second Co"]);
  });

  // A handler's test has to prove the paid service was never asked a second
  // time about an employer already filled in, which is a count rather than an
  // answer.
  test("a query asked twice is recorded twice", async () => {
    const search = fakeCompanySearch({});

    await search.search("First Co");
    await search.search("First Co");

    expect(search.asked).toEqual(["First Co", "First Co"]);
  });
});

describe("the fake failing", () => {
  test("an Error in the table is thrown for that query", async () => {
    const search = fakeCompanySearch({ "Broken Co": new Error("the service is down") });

    await expect(search.search("Broken Co")).rejects.toThrow("the service is down");
  });

  test("a missing credential can be arranged the same way", async () => {
    const search = fakeCompanySearch({
      "No Token Co": new MissingSearchCredentialError("APIFY_API_TOKEN is not set"),
    });

    await expect(search.search("No Token Co")).rejects.toBeInstanceOf(
      MissingSearchCredentialError
    );
  });

  test("a query that failed is still recorded as asked", async () => {
    const search = fakeCompanySearch({ "Broken Co": new Error("down") });

    await expect(search.search("Broken Co")).rejects.toThrow();

    expect(search.asked).toEqual(["Broken Co"]);
  });
});

// The one thing the project's other stand-ins cannot do. Testing the time
// limit needs a search that never answers at all.
describe("the fake never answering", () => {
  test("a query marked as never answering leaves the promise pending", async () => {
    vi.useFakeTimers();
    const search = fakeCompanySearch({ "Silent Co": NEVER_ANSWERS });

    let settled = false;
    void search.search("Silent Co").then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await vi.advanceTimersByTimeAsync(600_000);

    expect(settled).toBe(false);
    vi.useRealTimers();
  });

  test("a query that never answers is still recorded as asked", () => {
    const search = fakeCompanySearch({ "Silent Co": NEVER_ANSWERS });

    void search.search("Silent Co");

    expect(search.asked).toEqual(["Silent Co"]);
  });
});
