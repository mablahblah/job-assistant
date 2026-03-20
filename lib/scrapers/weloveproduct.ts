import { chromium } from "playwright";
import { type ScrapedJob } from "./types";

// Formats min/max salary to match project convention: "$150-188k"
function formatSalary(min?: number, max?: number): string {
  const k = (n: number) => Math.round(n / 1000);
  if (min && max) return `$${k(min)}-${k(max)}k`;
  if (min) return `$${k(min)}k+`;
  if (max) return `up to $${k(max)}k`;
  return "?";
}

// Extracts JobPosting JSON-LD from a detail page's @graph array
interface JobPostingLD {
  datePosted?: string;
  jobBenefits?: string;
  jobLocationType?: string;
  baseSalary?: {
    value?: { minValue?: number; maxValue?: number };
  };
  jobLocation?: {
    address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string };
  };
}

export async function scrapeWeLoveProduct(queries: string[]): Promise<ScrapedJob[]> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    throw new Error("Browser failed to launch — is Playwright installed? (npx playwright install chromium)");
  }

  try {
    const page = await browser.newPage();

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
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
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
    const lowerQueries = queries.map((q) => q.toLowerCase());
    const matchedStubs = stubs.filter((s) => {
      const title = s.title.toLowerCase();
      return lowerQueries.some((q) => title.includes(q));
    });

    // Step 2: visit each matched job's detail page for JSON-LD (date, salary, work mode)
    const allJobs: ScrapedJob[] = [];

    for (const stub of matchedStubs) {
      const jobUrl = stub.url.startsWith("http") ? stub.url : `https://weloveproduct.co${stub.url}`;

      let posting: JobPostingLD = {};
      try {
        await page.goto(jobUrl, { waitUntil: "networkidle", timeout: 15000 });

        // Parse all JSON-LD blocks and find the JobPosting entry
        posting = await page.evaluate(() => {
          const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
          for (const script of scripts) {
            try {
              const data = JSON.parse(script.textContent || "");
              // Could be a single object or have @graph array
              const nodes = data["@graph"] || [data];
              for (const node of nodes) {
                if (node["@type"] === "JobPosting") return node;
              }
            } catch { /* skip malformed JSON-LD */ }
          }
          return {};
        });
      } catch {
        // Detail page failed — still save the job with what we have from the listing
      }

      // Work mode: check jobBenefits or jobLocationType from structured data
      let workMode = "";
      const benefits = (posting.jobBenefits || "").toLowerCase();
      const locationType = (posting.jobLocationType || "").toLowerCase();
      if (locationType.includes("remote") || benefits.includes("remote")) {
        workMode = "remote";
      } else if (locationType.includes("hybrid") || benefits.includes("hybrid")) {
        workMode = "hybrid";
      } else if (stub.location) {
        // Has a specific location but no remote indicator
        workMode = "in-person";
      }

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
  } finally {
    await browser.close();
  }
}
