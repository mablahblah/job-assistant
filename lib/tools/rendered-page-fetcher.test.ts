import { createServer, type Server } from "node:http";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { createRenderedPageFetcher } from "./rendered-page-fetcher";

// Launching a real headless browser costs a second or two; a ceiling rather
// than a budget, because the suite runs test files in parallel.
const BROWSER_TIMEOUT_MS = 120_000;

const servers: Server[] = [];

afterAll(() => {
  for (const server of servers) {
    server.close();
  }
});

// A local server whose one page never finishes: the page's script starts a
// fetch the server never answers, so the network never goes idle. Nothing
// here leaves the machine, which is what keeps a real-browser test inside
// the no-live-requests rule.
function serveNeverSettlingPage(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url === "/hang") {
        // Deliberately no response: the fetch below stays pending forever.
        return;
      }
      response.setHeader("content-type", "text/html");
      response.end("<html><body><p>partial</p><script>fetch('/hang');</script></body></html>");
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${port}/`);
    });
  });
}

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
  // Criterion "A page that never settles is a failure". Handing back part of
  // a page would let the resume skill read half a posting as the whole one.
  test(
    "reports failure rather than handing back part of a page",
    async () => {
      const url = await serveNeverSettlingPage();
      const fetcher = createRenderedPageFetcher({ timeoutMs: 1_500 });

      await expect(fetcher.fetch(url)).rejects.toThrow();
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
