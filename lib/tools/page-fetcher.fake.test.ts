import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fakePageFetcher } from "./page-fetcher.fake";

// Launching a real headless browser costs a second or two. A ceiling rather
// than a budget, because the suite runs test files in parallel.
const BROWSER_TIMEOUT_MS = 60_000;

describe("fakePageFetcher: every host a test names is served on this machine", () => {
  const sites = fakePageFetcher({
    "careers.northwind.example/jobs/1": { body: "<p>Northwind posting</p>" },
    "careers.northwind.example/jobs/old": {
      redirectTo: "https://careers.northwind.example/jobs?error=true",
    },
    "careers.northwind.example/jobs?error=true": { body: "<p>Error page</p>" },
    "careers.northwind.example/gone": { status: 410, body: "gone" },
  });

  beforeAll(() => sites.start());
  afterAll(() => sites.stop());

  test("a plain request for a named page gets that page", async () => {
    const response = await sites.fetch("https://careers.northwind.example/jobs/1");
    expect(await response.text()).toBe("<p>Northwind posting</p>");
  });

  test("a page's own answer code comes back", async () => {
    const response = await sites.fetch("https://careers.northwind.example/gone");
    expect(response.status).toBe(410);
  });

  test("a page nobody named answers not found", async () => {
    const response = await sites.fetch("https://elsewhere.example/anything");
    expect(response.status).toBe(404);
  });

  test("a redirect lands on its target and reports the target's address", async () => {
    const response = await sites.fetch("https://careers.northwind.example/jobs/old");
    expect(await response.text()).toBe("<p>Error page</p>");
    expect(response.url).toBe("https://careers.northwind.example/jobs?error=true");
  });

  test("a plain request is recorded as one", async () => {
    await sites.fetch("https://careers.northwind.example/jobs/1?seen=fetch");
    expect(sites.visits).toContainEqual({
      host: "careers.northwind.example",
      path: "/jobs/1?seen=fetch",
      via: "fetch",
    });
  });

  test(
    "a browser reaches a named host and is recorded as a browser",
    async () => {
      const browser = await sites.launchBrowser();
      try {
        const page = await browser.newPage();
        await page.goto(`http://careers.northwind.example:${sites.port()}/jobs/1`);
        expect(await page.content()).toContain("Northwind posting");
      } finally {
        await browser.close();
      }
      expect(sites.visits).toContainEqual({
        host: "careers.northwind.example",
        path: "/jobs/1",
        via: "browser",
      });
      expect(sites.launches()).toBe(1);
    },
    BROWSER_TIMEOUT_MS
  );
});
