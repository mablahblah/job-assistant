import { chromium } from "playwright";
import { type ScrapedJob } from "./types";

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

        const titleEl = card.querySelector("h3, h4, [class*='title']");
        const companyEl = card.querySelector("[class*='company'], [class*='employer']");
        const locationEl = card.querySelector("[class*='location']");

        const idMatch = href.match(/\/jobs\/(\d+)/);
        results.push({
          title: titleEl?.textContent?.trim() || link.textContent?.trim() || "",
          company: companyEl?.textContent?.trim() || "",
          url: href,
          location: locationEl?.textContent?.trim() || "",
          id: idMatch?.[1] || href,
        });
      });

      return results;
    });

    return jobs.map((job) => ({
      externalId: job.id,
      title: job.title,
      companyName: job.company || "Unknown",
      url: job.url,
      location: job.location,
      workMode: job.location.toLowerCase().includes("remote") ? "remote" : "",
      postedAt: new Date(),
      salaryRange: "",
      description: "",
    }));
  } finally {
    await browser.close();
  }
}
