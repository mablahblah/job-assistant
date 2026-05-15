// lib/collectors/weloveproduct.ts
import type { CollectedJob } from "./types";
import { withBrowser } from "../scrapers/fetch-utils";
import { isStale } from "./parse-age";
import type { Page } from "playwright";

// Runs a single search on weloveproduct.co and collects results until 8d+ old.
async function runSearch(
  page: Page,
  query: string,
  remote: boolean,
): Promise<CollectedJob[]> {
  await page.goto("https://weloveproduct.co/", { waitUntil: "networkidle", timeout: 60000 });

  // Fill the search field
  const searchInput = await page.$('input[placeholder*="Product designer"]');
  if (!searchInput) throw new Error("WeLoveProduct search input not found");

  await searchInput.click();
  await page.waitForTimeout(500);
  await searchInput.type(query, { delay: 50 });
  await page.waitForTimeout(1000);

  // Dismiss the autocomplete overlay
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Toggle remote if needed — must use Playwright click to trigger React state
  if (remote) {
    const toggle = page.locator('button[role="switch"]');
    if (await toggle.count() > 0) {
      await toggle.first().click();
      await page.waitForTimeout(500);
    }
  }

  // Submit the search
  const submitBtn = page.locator('button:has-text("Search jobs")');
  if (await submitBtn.count() > 0) {
    await submitBtn.first().click();
  } else {
    throw new Error("WeLoveProduct submit button not found");
  }
  await page.waitForTimeout(3000);

  const jobs: CollectedJob[] = [];
  let shouldStop = false;

  // Paginate until we hit an 8d+ old job
  while (!shouldStop) {
    await page.waitForSelector("div.group.relative.max-w-full", { timeout: 10000 }).catch(() => null);

    // Scrape all cards on the current page
    const pageResults = await page.evaluate(() => {
      const results: Array<{ url: string; age: string }> = [];
      const cards = document.querySelectorAll("div.group.relative.max-w-full");

      cards.forEach((card) => {
        const titleLink = card.querySelector('a[href*="/jobs/"]:not([href*="/apply"])');
        if (!titleLink) return;

        const href = (titleLink as HTMLAnchorElement).href;
        const ageEl = card.querySelector(".text-xs.text-gray-400, .text-sm.text-gray-400");
        const age = ageEl?.textContent?.trim() || "";

        results.push({ url: href, age });
      });

      return results;
    });

    if (pageResults.length === 0) break;

    // Collect jobs until we hit an 8d+ old one
    for (const r of pageResults) {
      if (isStale(r.age)) {
        shouldStop = true;
        break;
      }
      jobs.push({
        url: r.url.startsWith("http") ? r.url : `https://weloveproduct.co${r.url}`,
        source: "weloveproduct",
      });
    }

    if (shouldStop) break;

    // Dismiss newsletter modal if it appeared
    const modalClose = page.locator('div[role="dialog"] button:has-text("Close"), div[role="dialog"] button[aria-label="Close"]');
    if (await modalClose.count() > 0) {
      await modalClose.first().click();
      await page.waitForTimeout(500);
    }

    // Try to load more results
    const loadMore = page.locator('button:has-text("Load more")');
    if (await loadMore.count() === 0) break;
    await loadMore.first().click();
    await page.waitForTimeout(2000);
  }

  return jobs;
}

// Collects product design jobs from WeLoveProduct using the site's search.
// Per search term: 1 remote search + 1 unfiltered search.
export async function collectWeLoveProduct(queries: string[]): Promise<CollectedJob[]> {
  return withBrowser(async (page) => {
    const allJobs: CollectedJob[] = [];

    for (const query of queries) {
      // Remote search
      const remoteJobs = await runSearch(page, query, true);
      allJobs.push(...remoteJobs);

      // Unfiltered search (pipeline classifies location downstream)
      const allLocationJobs = await runSearch(page, query, false);
      allJobs.push(...allLocationJobs);
    }

    return allJobs;
  });
}
