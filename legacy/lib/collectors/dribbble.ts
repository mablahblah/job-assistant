import type { CollectedJob } from "./types";
import { withBrowser } from "../scrapers/fetch-utils";
import { isStale, ageToDate } from "./parse-age";
import type { Page } from "playwright";

// Scrape job URLs and ages from the current Dribbble listing page.
async function scrapeCurrentPage(page: Page): Promise<Array<{ url: string; age: string }>> {
  return page.evaluate(() => {
    const results: Array<{ url: string; age: string }> = [];
    const cards = document.querySelectorAll("li.job-list-item");

    cards.forEach((card) => {
      const link = card.querySelector("a.job-link");
      if (!link) return;
      const href = (link as HTMLAnchorElement).href;

      const ageEl = card.querySelector(".posted-on");
      const age = ageEl?.textContent?.trim() || "";

      results.push({ url: href, age });
    });

    return results;
  });
}

// Builds a Dribbble jobs URL with the keyword and optional filters.
function buildUrl(query: string, opts: { location?: string; remote?: boolean }): string {
  const params = new URLSearchParams({ keyword: query });
  if (opts.location) params.set("location", opts.location);
  if (opts.remote) params.set("anywhere", "true");
  return `https://dribbble.com/jobs?${params.toString()}`;
}

// Runs a single Dribbble search via URL params, paginates until 8d+ old.
async function runSearch(
  page: Page,
  query: string,
  opts: { location?: string; remote?: boolean },
): Promise<CollectedJob[]> {
  await page.goto(buildUrl(query, opts), { waitUntil: "networkidle", timeout: 60000 });

  const jobs: CollectedJob[] = [];
  let shouldStop = false;

  // Paginate until we hit a stale (8d+) job or run out of pages
  while (!shouldStop) {
    const pageResults = await scrapeCurrentPage(page);
    if (pageResults.length === 0) break;

    for (const r of pageResults) {
      if (isStale(r.age)) {
        shouldStop = true;
        break;
      }
      const approxDate = ageToDate(r.age);
      jobs.push({
        url: r.url.startsWith("http") ? r.url : `https://dribbble.com${r.url}`,
        source: "dribbble",
        dates: approxDate ? [approxDate] : [],
      });
    }

    if (shouldStop) break;

    // Check for next page link
    const nextLink = await page.$('a:has-text("Next →")');
    if (!nextLink) break;

    await nextLink.click();
    await page.waitForTimeout(3000);
  }

  return jobs;
}

// Collects design jobs from Dribbble using search + filters.
// Per search term: 1 Austin search + 1 remote search.
export async function collectDribbble(queries: string[]): Promise<CollectedJob[]> {
  return withBrowser(async (page) => {
    const allJobs: CollectedJob[] = [];

    for (const query of queries) {
      // Austin-area search
      const austinJobs = await runSearch(page, query, { location: "Austin" });
      allJobs.push(...austinJobs);

      // Remote search
      const remoteJobs = await runSearch(page, query, { remote: true });
      allJobs.push(...remoteJobs);
    }

    return allJobs;
  });
}
