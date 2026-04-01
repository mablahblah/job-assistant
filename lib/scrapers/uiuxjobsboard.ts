import { type ScrapedJob } from "./types";
import {
  detectWorkModeFromData,
  formatSalary,
  parseSalaryFromText,
  parseJobPostingLD,
  matchesQuery,
  withBrowser,
} from "./fetch-utils";

// Parses relative time strings like "6d", "14h", "2w", "3mo" into a rough Date
function parseRelativeTime(text: string): Date {
  const now = new Date();
  const match = text.match(/(\d+)\s*(h|d|w|mo)/i);
  if (!match) return now;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms =
    { h: 3600000, d: 86400000, w: 604800000, mo: 2592000000 }[unit] ?? 0;
  return new Date(now.getTime() - num * ms);
}

// Returns true if a relative time string represents 7 days or older
function isSevenDaysOrOlder(text: string): boolean {
  const match = text.match(/(\d+)\s*(h|d|w|mo)/i);
  if (!match) return false;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === "h") return false;
  if (unit === "d") return num >= 7;
  // weeks and months are always >= 7 days
  return true;
}

export async function scrapeUiUxJobsBoard(
  queries: string[],
): Promise<ScrapedJob[]> {
  return withBrowser(async (page) => {
    try {
      await page.goto("https://uiuxjobsboard.com/design-jobs", {
        waitUntil: "load",
        timeout: 30000,
      });
    } catch {
      throw new Error("UIUXJobsBoard page load timeout");
    }

    // Wait for job cards to render
    await page
      .waitForSelector('a[href*="/job/"]', { timeout: 10000 })
      .catch(() => null);

    // Scroll until we see a job posted 7d+ ago, or hit 20 scroll attempts
    for (let i = 0; i < 20; i++) {
      // Check if any visible time label shows 7d or older
      const foundOldJob = await page.evaluate(() => {
        const els = document.querySelectorAll("time, [datetime]");
        for (const el of els) {
          const text = el.textContent?.trim() || "";
          const match = text.match(/(\d+)\s*(h|d|w|mo)/i);
          if (match) {
            const num = parseInt(match[1], 10);
            const unit = match[2].toLowerCase();
            if (unit === "d" && num >= 7) return true;
            if (unit === "w" || unit === "mo") return true;
          }
        }
        return false;
      });

      if (foundOldJob) break;

      // Scroll to bottom and wait for new content
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    // Step 1: collect job stubs from the listing page cards
    const stubs = await page.evaluate(() => {
      const results: Array<{
        title: string;
        company: string;
        url: string;
        location: string;
        workMode: string;
        timeText: string;
        id: string;
      }> = [];

      const links = document.querySelectorAll('a[href*="/job/"]');
      const seen = new Set<string>();

      links.forEach((link) => {
        const href = (link as HTMLAnchorElement).href;
        if (seen.has(href)) return;
        seen.add(href);

        // Walk up to the full card container (has rounded-xl + border classes)
        const card =
          link.closest(".rounded-xl") || link.closest("article") || link.closest("li") || link.closest("div");
        if (!card) return;

        // Title — bold span with primaryColor class
        const titleEl = card.querySelector(
          "span.text-primaryColor, .text-2xl.font-bold",
        );
        const title = titleEl?.textContent?.trim() || "";

        // Company — inside the text-xl span, grab first text node only (skip "is hiring" child)
        const companySpan = card.querySelector(".text-xl span > span");
        let company = "";
        if (companySpan) {
          // firstChild is the text node with the company name, before the "is hiring" child span
          company = companySpan.firstChild?.textContent?.trim() || "";
        }

        // Location + work mode — extracted from tag links in the metadata div
        const tagLinks = Array.from(
          card.querySelectorAll('a[href*="/design-jobs/"]'),
        ) as HTMLAnchorElement[];
        const locationParts: string[] = [];
        let workMode = "";
        for (const tag of tagLinks) {
          const tagHref = tag.getAttribute("href") || "";
          const tagText = tag.textContent?.trim() || "";
          // Check href for remote/hybrid signals
          if (tagHref.includes("/remote")) {
            workMode = "remote";
          } else if (tagHref.includes("/hybrid") && !workMode) {
            workMode = "hybrid";
          }
          if (tagText) locationParts.push(tagText);
        }
        const location = locationParts.join(", ");

        // Time — last div.text-sm in the card (e.g. "2d", "14h")
        const timeDivs = card.querySelectorAll("div.text-sm");
        const timeEl = timeDivs[timeDivs.length - 1];
        const timeText = timeEl?.textContent?.trim() || "";

        // Slug from URL for externalId
        const slugMatch = href.match(/\/job\/(.+)/);

        results.push({
          title,
          company,
          url: href,
          location,
          workMode,
          timeText,
          id: slugMatch?.[1] || href,
        });
      });

      return results;
    });

    // Filter by query before visiting detail pages
    const matchedStubs = stubs.filter((s) => matchesQuery(s.title, queries));

    // Step 2: visit each matched job's detail page for salary, date, and work mode
    const allJobs: ScrapedJob[] = [];

    for (const stub of matchedStubs) {
      const jobUrl = stub.url.startsWith("http")
        ? stub.url
        : `https://uiuxjobsboard.com${stub.url}`;

      // Start with listing card data
      let postedAt = stub.timeText
        ? parseRelativeTime(stub.timeText)
        : new Date();
      let workMode = stub.workMode; // from card location link hrefs
      let salary = "?";
      let company = stub.company;
      let location = stub.location;

      try {
        await page.goto(jobUrl, { waitUntil: "load", timeout: 15000 });

        // Try JSON-LD first
        const posting = await parseJobPostingLD(page);

        if (posting.datePosted) postedAt = new Date(posting.datePosted);

        // Company from JSON-LD overrides card extraction (most reliable)
        if (posting.hiringOrganization?.name) {
          company = posting.hiringOrganization.name;
        }

        // Location from JSON-LD (e.g. "London, United Kingdom")
        const addr = Array.isArray(posting.jobLocation)
          ? posting.jobLocation[0]?.address
          : posting.jobLocation?.address;
        if (addr?.addressLocality || addr?.addressRegion) {
          const parts = [addr.addressLocality, addr.addressRegion].filter(Boolean);
          if (parts.length) location = parts.join(", ");
        }

        // Structured work mode from JSON-LD overrides card data
        const ldWorkMode = detectWorkModeFromData({
          jobLocationType: posting.jobLocationType,
          jobBenefits: posting.jobBenefits,
        });
        if (ldWorkMode) workMode = ldWorkMode;

        // If still no work mode, check detail page location section (scoped to h1 area, not footer)
        if (!workMode) {
          workMode = await page.evaluate(() => {
            // Location links live near the h1 — scope to main content, skip the global footer
            const main = document.querySelector("h1")?.closest("div") || document.querySelector("main");
            if (!main) return "";
            const links = main.querySelectorAll('a[href*="/design-jobs/"]');
            for (const link of links) {
              const href = link.getAttribute("href") || "";
              if (href.includes("/remote")) return "remote";
              if (href.includes("/hybrid")) return "hybrid";
            }
            return "";
          });
        }

        // Salary from JSON-LD baseSalary or page text
        const baseSalary = posting.baseSalary?.value;
        if (baseSalary?.minValue || baseSalary?.maxValue) {
          salary = formatSalary(baseSalary.minValue, baseSalary.maxValue);
        } else {
          const pageText = await page.evaluate(() => document.body.innerText);
          salary = parseSalaryFromText(pageText);
        }
      } catch {
        // Detail page failed — save with listing data
      }

      allJobs.push({
        externalId: stub.id,
        title: stub.title,
        companyName: company || "Unknown",
        url: jobUrl,
        location,
        workMode,
        postedAt,
        salaryRange: salary,
        description: "",
      });
    }

    return allJobs;
  });
}
