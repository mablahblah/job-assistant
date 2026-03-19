import { chromium } from "playwright";
import { type ScrapedJob } from "./types";

export async function scrapeWeLoveProduct(queries: string[]): Promise<ScrapedJob[]> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    throw new Error("Browser failed to launch — is Playwright installed? (npx playwright install chromium)");
  }

  try {
    const page = await browser.newPage();
    const allJobs: ScrapedJob[] = [];

    for (let pageNum = 0; pageNum < 3; pageNum++) {
      const url = `https://weloveproduct.co/product-designer-jobs${pageNum > 0 ? `?page=${pageNum}` : ""}`;

      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch {
        if (pageNum === 0) throw new Error("WeLoveProduct page load timeout");
        break; // pagination page failed, stop paging
      }

      const jobs = await page.evaluate(() => {
        const results: Array<{
          title: string;
          company: string;
          url: string;
          location: string;
          salary: string;
          id: string;
        }> = [];

        const jobLinks = document.querySelectorAll('a[href*="/jobs/"]');
        const seen = new Set<string>();

        jobLinks.forEach((link) => {
          const href = (link as HTMLAnchorElement).href;
          if (seen.has(href) || href.includes("/jobs?")) return;
          seen.add(href);

          const card = link.closest("li") || link.closest("div") || link.parentElement;
          if (!card) return;

          const companyLink = card.querySelector('a[href*="/companies/"]');
          const locationEl = card.querySelector("[class*='location'], [class*='loc']");
          const salaryEl = card.querySelector("[class*='salary']");

          results.push({
            title: link.textContent?.trim() || "",
            company: companyLink?.textContent?.trim() || "",
            url: href,
            location: locationEl?.textContent?.trim() || "",
            salary: salaryEl?.textContent?.trim() || "",
            id: href.split("/jobs/")[1] || href,
          });
        });

        return results;
      });

      if (jobs.length === 0) break;

      allJobs.push(
        ...jobs.map((job) => ({
          externalId: job.id,
          title: job.title,
          companyName: job.company || "Unknown",
          url: job.url.startsWith("http") ? job.url : `https://weloveproduct.co${job.url}`,
          location: job.location,
          workMode: job.location.toLowerCase().includes("remote") ? "remote" : "",
          postedAt: new Date(),
          salaryRange: job.salary,
          description: "",
        }))
      );
    }

    const lowerQueries = queries.map((q) => q.toLowerCase());
    return allJobs.filter((job) => {
      const title = job.title.toLowerCase();
      return lowerQueries.some((q) => title.includes(q));
    });
  } finally {
    await browser.close();
  }
}
