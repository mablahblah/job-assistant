import type { CollectedJob } from "./types";
import { isStale, ageToDate } from "./parse-age";
import { matchCategories, type Category } from "./match-categories";
import { chromium, type Page } from "playwright";

// The fixed category list from UIUXJobsBoard
const UIUX_CATEGORIES: Category[] = [
  { value: "ui-designer", label: "UI Design" },
  { value: "ux-designer", label: "UX Design" },
  { value: "ui-ux-designer", label: "UI/UX Design" },
  { value: "product-designer", label: "Product Design" },
  { value: "ux-researcher", label: "UX Research" },
  { value: "ux-writer", label: "UX Writing" },
];

// Remote region values — selected after remote checkbox swaps country→region
const REMOTE_REGIONS = ["anywhere", "north-america", "united-states"];

// Scrape job URLs and ages from currently visible cards.
async function scrapeVisibleJobs(page: Page): Promise<Array<{ url: string; age: string }>> {
  return page.evaluate(() => {
    const results: Array<{ url: string; age: string }> = [];
    const cards = document.querySelectorAll("div.border.shadow-xs.rounded-xl");

    cards.forEach((card) => {
      const link = card.querySelector('a[href*="/job/"]');
      if (!link) return;
      const href = (link as HTMLAnchorElement).href;

      const ageEl = card.querySelector("div.text-sm");
      const age = ageEl?.textContent?.trim() || "";

      results.push({ url: href, age });
    });

    return results;
  });
}

// Runs a single filtered search: sets category, optionally remote + region, then scrolls.
async function runFilteredSearch(
  page: Page,
  category: string,
  remote: boolean,
  region?: string,
): Promise<CollectedJob[]> {
  await page.goto("https://uiuxjobsboard.com/", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Set the category dropdown
  await page.selectOption("select#jobcategory", category);
  await page.waitForTimeout(500);

  if (remote) {
    // Click remote checkbox via Playwright (not JS) to trigger the country→region dropdown swap
    await page.click("input#remoteyes").catch(() => page.click('label:has-text("Yes")'));
    await page.waitForTimeout(1500);

    // Set region (dropdown swaps from #jobcountry to #jobregion after remote checked)
    if (region) {
      await page.selectOption("select#jobregion", region);
      await page.waitForTimeout(500);
    }
  }

  // Click search
  await page.locator('button:has-text("Search")').click();
  await page.waitForTimeout(3000);

  const jobs: CollectedJob[] = [];
  let shouldStop = false;
  let prevCount = 0;

  // Scroll until we hit an 8d+ old job or no new jobs load
  for (let i = 0; i < 20 && !shouldStop; i++) {
    const pageResults = await scrapeVisibleJobs(page);

    // Only process newly loaded cards
    const newResults = pageResults.slice(prevCount);
    if (newResults.length === 0) break;

    for (const r of newResults) {
      // Stop collecting once we hit an 8d+ old job
      if (isStale(r.age)) {
        shouldStop = true;
        break;
      }
      const approxDate = ageToDate(r.age);
      jobs.push({
        url: r.url.startsWith("http") ? r.url : `https://uiuxjobsboard.com${r.url}`,
        source: "uiuxjobsboard",
        dates: approxDate ? [approxDate] : [],
      });
    }

    if (shouldStop) break;

    prevCount = pageResults.length;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    // Check if new content loaded
    const newTotal = await page.evaluate(() =>
      document.querySelectorAll("div.border.shadow-xs.rounded-xl").length,
    );
    if (newTotal === prevCount) break;
  }

  return jobs;
}

// Collects design jobs from UIUXJobsBoard using category + region filters.
// Matches SEARCH_TERMS to site categories, then runs 4 searches per matched category.
export async function collectUiUxJobsBoard(queries: string[]): Promise<CollectedJob[]> {
  const matched = matchCategories(queries, UIUX_CATEGORIES);
  if (matched.length === 0) {
    console.error("[uiuxjobsboard] No categories matched search terms");
    return [];
  }

  console.error(`[uiuxjobsboard] Matched categories: ${matched.map((c) => c.label).join(", ")}`);

  // Launch non-headless — this site's remote checkbox needs visible interaction to swap the dropdown
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    headless: false,
    ...(executablePath ? { executablePath } : {}),
  });

  try {
    const page = await browser.newPage();
    const allJobs: CollectedJob[] = [];

    for (const cat of matched) {
      // 1. All jobs (no remote filter) — catches local/hybrid
      const allLocationJobs = await runFilteredSearch(page, cat.value, false);
      allJobs.push(...allLocationJobs);

      // 2-4. Remote searches with different regions
      for (const region of REMOTE_REGIONS) {
        const remoteJobs = await runFilteredSearch(page, cat.value, true, region);
        allJobs.push(...remoteJobs);
      }
    }

    return allJobs;
  } finally {
    await browser.close();
  }
}
