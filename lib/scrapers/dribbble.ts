import { type ScrapedJob } from "./types";
import {
  detectWorkModeFromText,
  detectWorkModeFromData,
  formatSalary,
  parseSalaryFromText,
  parseJobPostingLD,
  withBrowser,
} from "./fetch-utils";

export async function scrapeDribbble(query = "Product Designer"): Promise<ScrapedJob[]> {
  return withBrowser(async (page) => {
    const url = `https://dribbble.com/jobs?search=${encodeURIComponent(query)}`;

    try {
      // "load" fires after initial resources — avoids hanging on analytics/polling that never reach networkidle
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
    } catch {
      throw new Error("Dribbble page load timeout");
    }

    // Wait for job cards to render
    await page.waitForSelector('[data-testid="job-card"], .job-listing, ol li a[href*="/jobs/"]', {
      timeout: 10000,
    }).catch(() => null); // page might have no results

    // Step 1: collect job stubs from listing page
    const stubs = await page.evaluate(() => {
      const results: Array<{
        title: string;
        company: string;
        url: string;
        location: string;
        workModeText: string;
        id: string;
      }> = [];

      const links = document.querySelectorAll('a[href*="/jobs/"]');
      const seen = new Set<string>();

      links.forEach((link) => {
        const href = (link as HTMLAnchorElement).href;
        if (!href.match(/\/jobs\/\d+/) || seen.has(href)) return;
        seen.add(href);

        const card = link.closest("li") || link.closest("div");
        if (!card) return;

        // Use specific Dribbble class names to avoid grabbing tooltip/parent text
        const titleEl = card.querySelector(".job-board-job-title");
        const companyEl = card.querySelector(".job-board-job-company");
        const locationEl = card.querySelector(".location-container");
        // Dribbble shows remote label in a sibling div outside .location-container
        const jobDetailsEl = card.querySelector(".job-details");

        const idMatch = href.match(/\/jobs\/(\d+)/);
        results.push({
          title: titleEl?.textContent?.trim() || link.textContent?.trim() || "",
          company: companyEl?.textContent?.trim() || "",
          url: href,
          location: locationEl?.textContent?.trim() || "",
          workModeText: jobDetailsEl?.textContent?.trim() || "",
          id: idMatch?.[1] || href,
        });
      });

      return results;
    });

    // Step 2: visit each detail page for salary, date, and work mode via JSON-LD
    const allJobs: ScrapedJob[] = [];

    for (const stub of stubs) {
      const jobUrl = stub.url.startsWith("http") ? stub.url : `https://dribbble.com${stub.url}`;

      let salary = "?";
      let postedAt = new Date();
      // Prefer structured data for work mode, fall back to listing card text, default to in-person
      let workMode = detectWorkModeFromText(stub.workModeText, "in-person");

      try {
        await page.goto(jobUrl, { waitUntil: "load", timeout: 15000 });

        // Parse JSON-LD for date and work mode
        const posting = await parseJobPostingLD(page);

        if (posting.datePosted) postedAt = new Date(posting.datePosted);

        // Structured work mode from JSON-LD overrides listing card text
        const ldWorkMode = detectWorkModeFromData({
          jobLocationType: posting.jobLocationType,
          jobBenefits: posting.jobBenefits,
        });
        if (ldWorkMode) workMode = ldWorkMode;

        // Salary from JSON-LD baseSalary (structured) or page text (regex)
        const baseSalary = posting.baseSalary?.value;
        if (baseSalary?.minValue || baseSalary?.maxValue) {
          salary = formatSalary(baseSalary.minValue, baseSalary.maxValue);
        } else {
          // Fall back to scraping salary from page text
          const pageText = await page.evaluate(() => document.body.innerText);
          salary = parseSalaryFromText(pageText);
        }
      } catch {
        // Detail page failed — still save the job with what we have from the listing
      }

      allJobs.push({
        externalId: stub.id,
        title: stub.title,
        companyName: stub.company || "",
        url: jobUrl,
        location: stub.location,
        workMode,
        postedAt,
        salaryRange: salary,
        description: "",
      });
    }

    return allJobs;
  });
}
