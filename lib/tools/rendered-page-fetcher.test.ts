import { createServer, type Server } from "node:http";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { afterAll, describe, expect, test } from "vitest";
import { createRenderedPageFetcher, createRenderedPageBrowser } from "./rendered-page-fetcher";

// Launching a real headless browser costs a second or two; a ceiling rather
// than a budget, because the suite runs test files in parallel.
const BROWSER_TIMEOUT_MS = 120_000;

const servers: Server[] = [];

afterAll(() => {
  for (const server of servers) {
    server.close();
  }
});

// A local server holding pages by path. "/hang" is never answered, so any
// page asking for it keeps a request open for as long as it is on screen.
// Nothing here leaves the machine, which is what keeps a real-browser test
// inside the no-live-requests rule.
function servePages(pages: Record<string, string>): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const page = pages[request.url ?? ""];
      if (request.url === "/hang" || page === undefined) {
        // Deliberately no response: whatever asked for it stays pending.
        return;
      }
      response.setHeader("content-type", "text/html");
      response.end(page);
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

// Keeps the network busy from the moment it runs: one request the server
// never answers, and a fresh one every fifth of a second.
const NEVER_QUIET =
  "<script>fetch('/hang').catch(function () {});" +
  "setInterval(function () { fetch('/poll').catch(function () {}); }, 200);</script>";

describe("fetching a page whose text is built by scripts", () => {
  // Criterion "The rendered page fetch exists". The text is not in the
  // page's own markup at all — a script writes it after load — so only a
  // browser that ran the script can hand it back.
  test(
    "the finished text comes back",
    async () => {
      const fetcher = createRenderedPageFetcher();
      const html = await fetcher.fetch(
        "data:text/html,<div id='x'></div>" +
          "<script>document.getElementById('x').textContent='built by script';</script>"
      );

      expect(html).toContain("built by script");
    },
    BROWSER_TIMEOUT_MS
  );
});

describe("a page that never settles", () => {
  // Criterion "A page that never settles is a failure". The page's own
  // picture never arrives, so it never finishes loading, and handing back
  // part of it would let the resume skill read half a posting as the whole.
  test(
    "reports failure rather than handing back part of a page",
    async () => {
      const site = await servePages({ "/": "<html><body><p>partial</p><img src='/hang'></body></html>" });
      const fetcher = createRenderedPageFetcher({ timeoutMs: 1_500 });

      await expect(fetcher.fetch(`${site}/`)).rejects.toThrow();
    },
    BROWSER_TIMEOUT_MS
  );
});

describe("a page that keeps loading after it has loaded", () => {
  // Criterion "A page that never stops loading is still read". Measured on
  // Dover, a job page's script writes its job data a moment after loading and
  // keeps asking its server for more for as long as the page is open.
  test(
    "its job data is read once it appears",
    async () => {
      const site = await servePages({
        "/": (
          "<html><head></head><body><div id='app'></div>" +
          "<script>setTimeout(function () {" +
          "  var block = document.createElement('script');" +
          "  block.type = 'application/ld+json';" +
          "  block.textContent = '{\"@type\":\"JobPosting\",\"title\":\"written late\"}';" +
          "  document.head.appendChild(block);" +
          "}, 300);</script>" +
          NEVER_QUIET +
          "</body></html>"
        ),
      });
      const fetcher = createRenderedPageFetcher({ timeoutMs: 5_000 });

      await expect(fetcher.fetch(`${site}/`)).resolves.toContain("written late");
    },
    BROWSER_TIMEOUT_MS
  );

  test(
    "a page whose job data never appears is handed back once it has loaded",
    async () => {
      const site = await servePages({
        "/": `<html><body><p>no job data here</p>${NEVER_QUIET}</body></html>`,
      });
      const fetcher = createRenderedPageFetcher({ timeoutMs: 5_000, jobDataWaitMs: 500 });

      await expect(fetcher.fetch(`${site}/`)).resolves.toContain("no job data here");
    },
    BROWSER_TIMEOUT_MS
  );
});

describe("one browser for a whole job search", () => {
  // A browser launch is the pipeline's most expensive step, so a job search
  // opens one and reads every page that needs it through that one.
  test(
    "one browser reads every page it is asked for",
    async () => {
      const site = await servePages({
        "/one": "<html><body><p>first page</p></body></html>",
        "/two": "<html><body><p>second page</p></body></html>",
      });
      let launches = 0;
      const browser = await createRenderedPageBrowser(
        () => {
          launches += 1;
          return chromium.launch({ headless: true });
        },
        { jobDataWaitMs: 100 }
      );
      try {
        await expect(browser.fetch(`${site}/one`)).resolves.toContain("first page");
        await expect(browser.fetch(`${site}/two`)).resolves.toContain("second page");
      } finally {
        await browser.close();
      }
      expect(launches).toBe(1);
    },
    BROWSER_TIMEOUT_MS
  );

  test(
    "a page is read the same way a single read reads it",
    async () => {
      const site = await servePages({
        "/": (
          "<html><head></head><body>" +
          "<script>setTimeout(function () {" +
          "  var block = document.createElement('script');" +
          "  block.type = 'application/ld+json';" +
          "  block.textContent = '{\"@type\":\"JobPosting\",\"title\":\"written late\"}';" +
          "  document.head.appendChild(block);" +
          "}, 300);</script>" +
          NEVER_QUIET +
          "</body></html>"
        ),
      });
      const browser = await createRenderedPageBrowser(() => chromium.launch({ headless: true }), {
        timeoutMs: 5_000,
      });
      try {
        await expect(browser.fetch(`${site}/`)).resolves.toContain("written late");
      } finally {
        await browser.close();
      }
    },
    BROWSER_TIMEOUT_MS
  );
});

describe("the two fetchers cannot be confused", () => {
  // Criterion "The two fetchers cannot be confused". fetch-page reads raw,
  // script-free page text; this tool's name says it renders.
  test("the tools folder holds both, each named for what it does", () => {
    const files = readdirSync(dirname(fileURLToPath(import.meta.url)));

    expect(files).toContain("rendered-page-fetcher.ts");
    expect(files).toContain("fetch-page.ts");
  });
});
