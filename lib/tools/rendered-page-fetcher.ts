// The tool that wraps Playwright for one page-render fetch. Everything else
// in this codebase that talks to the outside world is reached through a
// tool like this one. This is the browser-driven fetcher — the name says it
// renders — distinct from fetch-page.ts beside it, which reads raw,
// script-free page text without a browser. The resume skill reads job
// postings through this one, because many postings build their text with
// scripts after load.
import { chromium } from "playwright";

export interface RenderedPageFetcher {
  // The finished HTML after scripts have run and the network has gone idle.
  // Throws when the page never settles: part of a page is not an answer.
  fetch(url: string): Promise<string>;
}

export interface RenderedPageFetcherOptions {
  timeoutMs?: number;
}

// How long one page gets to finish. Generous next to the pipeline's own
// limits because this tool is reached for by hand, one posting at a time,
// where waiting is cheaper than being told to try again.
const DEFAULT_TIMEOUT_MS = 30_000;

export function createRenderedPageFetcher(
  options: RenderedPageFetcherOptions = {}
): RenderedPageFetcher {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async fetch(url: string): Promise<string> {
      // Headless is deliberate: the measured refusals of invisible browsers
      // came from aggregator redirect links, which this tool rarely fetches.
      // A refusal showing up in practice is what would reopen that question.
      // The legacy fetcher this ports ran headless too.
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        // A goto that times out rejects, and that rejection is left to
        // propagate — a page that never settles is a failure, never a
        // partial answer.
        await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
        return await page.content();
      } finally {
        await browser.close();
      }
    },
  };
}
