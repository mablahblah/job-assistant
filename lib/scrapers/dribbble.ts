import { chromium } from "playwright";
import { type ScrapedJob } from "./types";

// Dribbble uses a separate label div for remote/hybrid — check that text first, then fall back to location
function detectWorkMode(workModeText: string): string {
  const lower = workModeText.toLowerCase();
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("remote")) return "remote";
  return "in-person";
}

export async function scrapeDribbble(query = "Product Designer"): Promise<ScrapedJob[]> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    throw new Error("Browser failed to launch — is Playwright installed? (npx playwright install chromium)");
  }

  try {
    const page = await browser.newPage();
    const url = `https://dribbble.com/jobs?search=${encodeURIComponent(query)}`;

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      throw new Error("Dribbble page load timeout");
    }

    // Wait for job cards to render
    await page.waitForSelector('[data-testid="job-card"], .job-listing, ol li a[href*="/jobs/"]', {
      timeout: 10000,
    }).catch(() => null); // page might have no results

    const jobs = await page.evaluate(() => {
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

    return jobs.map((job) => ({
      externalId: job.id,
      title: job.title,
      companyName: job.company || "",
      url: job.url,
      location: job.location,
      workMode: detectWorkMode(job.workModeText),
      postedAt: new Date(),
      salaryRange: "?",
      description: "",
    }));
  } finally {
    await browser.close();
  }
}
