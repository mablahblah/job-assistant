// The tool that wraps Playwright for page-render fetches. Everything else
// in this codebase that talks to the outside world is reached through a
// tool like this one. This is the browser-driven fetcher — the name says it
// renders — distinct from fetch-page.ts beside it, which reads raw,
// script-free page text without a browser. The resume skill reads job
// postings through this one, because many postings build their text with
// scripts after load.
//
// Two ways to use it: `createRenderedPageFetcher` opens and closes its own
// browser for one page, for a single fetch done by hand. `createRenderedPageBrowser`
// opens one browser and reads many pages through it, for a job search that
// has several postings to read and does not want to pay browser start-up
// per page.
import { chromium } from "playwright";

export interface RenderedPageFetcher {
  // Waits for the page's load event, then gives its scripts a further
  // window to attach search-engine job data (a <script
  // type="application/ld+json"> element) before handing back the HTML.
  // The HTML comes back either way — with the job data if it showed up in
  // time, or as it stood once that wait ran out. Throws only when the page
  // itself never finishes loading: that, and that alone, is not an answer.
  fetch(url: string): Promise<string>;
}

export interface RenderedPageFetcherOptions {
  timeoutMs?: number;
  jobDataWaitMs?: number;
}

// How long one page gets to finish loading. Generous next to the pipeline's
// own limits because this tool is reached for by hand, one posting at a
// time, where waiting is cheaper than being told to try again.
const DEFAULT_TIMEOUT_MS = 30_000;

// How long to keep watching a loaded page for search-engine job data before
// giving up and handing back what is there. Measured on 2026-09-25: job
// data appeared within 1.4 seconds of loading on three Dover pages.
const DEFAULT_JOB_DATA_WAIT_MS = 5_000;

// The tag a page's job data lives in, wherever a script attaches it.
const JOB_DATA_SELECTOR = 'script[type="application/ld+json"]';

// The narrow slice of a Playwright page this file calls. A real Playwright
// `Page` satisfies this without a cast, so a caller can hand in a real
// browser's page, or a fake one in tests.
export interface LaunchedRenderedPage {
  goto(
    url: string,
    options: { waitUntil: "load"; timeout: number }
  ): Promise<unknown>;
  waitForSelector(
    selector: string,
    options: { state: "attached"; timeout: number }
  ): Promise<unknown>;
  content(): Promise<string>;
  close(): Promise<void>;
}

// The narrow slice of a Playwright browser this file calls. A real
// Playwright `Browser` satisfies this without a cast.
export interface LaunchedRenderedBrowser {
  newPage(): Promise<LaunchedRenderedPage>;
  close(): Promise<void>;
}

// Taken as an argument rather than called inside as `chromium.launch`, so a
// caller can supply its own launcher — the same reason
// lib/tools/resolution-browser.ts takes one.
export type RenderedPageLauncher = () => Promise<LaunchedRenderedBrowser>;

// Headless is deliberate: the measured refusals of invisible browsers came
// from aggregator redirect links, which this tool rarely fetches. A refusal
// showing up in practice is what would reopen that question. The legacy
// fetcher this ports ran headless too.
const defaultLaunch: RenderedPageLauncher = () =>
  chromium.launch({ headless: true });

// The one readiness rule, used by both the single read and the browser
// session so it exists once. Waits for the page's load event, then gives
// the page's scripts a further window to attach search-engine job data.
// Only that second wait running out is swallowed — the page still has an
// answer worth handing back, just without job data in it. A goto that times
// out rejects, and that rejection is left to propagate — a page that never
// loads is a failure, never a partial answer. Waiting for "load" rather
// than network quiet is deliberate: job pages whose scripts keep polling
// the server for more never go network-idle, so that wait would never
// finish.
async function readRenderedPage(
  page: LaunchedRenderedPage,
  url: string,
  timeoutMs: number,
  jobDataWaitMs: number
): Promise<string> {
  await page.goto(url, { waitUntil: "load", timeout: timeoutMs });

  // The job data is never visible, so this waits for the element to be
  // attached to the document, not to be shown.
  try {
    await page.waitForSelector(JOB_DATA_SELECTOR, {
      state: "attached",
      timeout: jobDataWaitMs,
    });
  } catch {
    // No job data showed up in time; fall through and hand back the page
    // as it stands.
  }

  return await page.content();
}

export function createRenderedPageFetcher(
  options: RenderedPageFetcherOptions = {}
): RenderedPageFetcher {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const jobDataWaitMs = options.jobDataWaitMs ?? DEFAULT_JOB_DATA_WAIT_MS;

  return {
    async fetch(url: string): Promise<string> {
      // One browser per call, closed whatever happens — this is the
      // single-read path, for a fetch done by hand.
      const browser = await defaultLaunch();
      try {
        const page = await browser.newPage();
        return await readRenderedPage(page, url, timeoutMs, jobDataWaitMs);
      } finally {
        await browser.close();
      }
    },
  };
}

export interface RenderedPageBrowser {
  // Opens a fresh page on the one browser, reads it with the same
  // readiness rule as the single read, and closes that page afterward
  // whatever happens. The browser itself stays open for the next fetch.
  fetch(url: string): Promise<string>;
  // Closes the one browser. Call once, when there are no more pages to read.
  close(): Promise<void>;
}

// Opens one browser and hands back a session that reads many pages through
// it, so a job search with several postings to read does not pay browser
// start-up per page. `launch` is called exactly once, here.
export async function createRenderedPageBrowser(
  launch: RenderedPageLauncher = defaultLaunch,
  options: RenderedPageFetcherOptions = {}
): Promise<RenderedPageBrowser> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const jobDataWaitMs = options.jobDataWaitMs ?? DEFAULT_JOB_DATA_WAIT_MS;
  const browser = await launch();

  return {
    async fetch(url: string): Promise<string> {
      const page = await browser.newPage();
      try {
        return await readRenderedPage(page, url, timeoutMs, jobDataWaitMs);
      } finally {
        await page.close();
      }
    },
    close: () => browser.close(),
  };
}
