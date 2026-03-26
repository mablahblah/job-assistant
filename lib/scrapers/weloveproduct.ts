import { type ScrapedJob } from "./types";
import { formatSalary, detectWorkModeFromData, matchesQuery, parseJobPostingLD, type JobPostingLD, withBrowser } from "./fetch-utils";

export async function scrapeWeLoveProduct(queries: string[]): Promise<ScrapedJob[]> {
  return withBrowser(async (page) => {

    // Step 1: collect job stubs from listing pages (title, company, url, location from card)
    const stubs: Array<{
      title: string;
      company: string;
      url: string;
      location: string;
      id: string;
    }> = [];

    for (let pageNum = 0; pageNum < 3; pageNum++) {
      const url = `https://weloveproduct.co/product-designer-jobs${pageNum > 0 ? `?page=${pageNum}` : ""}`;

      try {
        // "load" fires after initial resources — avoids hanging on analytics/polling that never reach networkidle
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
      } catch {
        if (pageNum === 0) throw new Error("WeLoveProduct page load timeout");
        break;
      }

      const pageJobs = await page.evaluate(() => {
        const results: Array<{
          title: string;
          company: string;
          url: string;
          location: string;
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
          // Location is an <a href="/locations/..."> link on the card
          const locationLink = card.querySelector('a[href*="/locations/"]');

          results.push({
            title: link.textContent?.trim() || "",
            company: companyLink?.textContent?.trim() || "",
            url: href,
            location: locationLink?.textContent?.trim() || "",
            id: href.split("/jobs/")[1] || href,
          });
        });

        return results;
      });

      if (pageJobs.length === 0) break;
      stubs.push(...pageJobs);
    }

    // Filter by query before visiting detail pages (avoid unnecessary page loads)
    const matchedStubs = stubs.filter((s) => matchesQuery(s.title, queries));

    // Step 2: visit each matched job's detail page for JSON-LD (date, salary, work mode)
    const allJobs: ScrapedJob[] = [];

    for (const stub of matchedStubs) {
      const jobUrl = stub.url.startsWith("http") ? stub.url : `https://weloveproduct.co${stub.url}`;

      let posting: JobPostingLD = {};
      try {
        // "load" fires after initial resources — avoids hanging on analytics/polling that never reach networkidle
        await page.goto(jobUrl, { waitUntil: "load", timeout: 15000 });
        posting = await parseJobPostingLD(page);
      } catch {
        // Detail page failed — still save the job with what we have from the listing
      }

      // Work mode from structured JSON-LD, fall back to in-person if location exists
      const workMode = detectWorkModeFromData({
        jobLocationType: posting.jobLocationType,
        jobBenefits: posting.jobBenefits,
      }) || (stub.location ? "in-person" : "");

      const salary = posting.baseSalary?.value;

      allJobs.push({
        externalId: stub.id,
        title: stub.title,
        companyName: stub.company || "Unknown",
        url: jobUrl,
        location: stub.location,
        workMode,
        postedAt: posting.datePosted ? new Date(posting.datePosted) : new Date(),
        salaryRange: formatSalary(salary?.minValue, salary?.maxValue),
        description: "",
      });
    }

    return allJobs;
  });
}
