"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { saveScrapedJobs, getOrCreateSystemTerm, type ScraperSaveResult } from "@/lib/scraper-save";
import { scrapeAdzuna } from "@/lib/scrapers/adzuna";
import { scrapeJSearch } from "@/lib/scrapers/jsearch";
import { scrapeGreenhouseCompany } from "@/lib/scrapers/greenhouse";
import { scrapeLeverCompany } from "@/lib/scrapers/lever";
import { scrapeDribbble } from "@/lib/scrapers/dribbble";
import { scrapeWeLoveProduct } from "@/lib/scrapers/weloveproduct";
import { scrapeRemotive } from "@/lib/scrapers/remotive";
import { scrapeUiUxJobsBoard } from "@/lib/scrapers/uiuxjobsboard";
import { SCRAPER_CONFIG } from "@/lib/scrapers/scraper-config";

// Get user search terms (excludes system terms starting with __)
async function getUserSearchTerms() {
  const all = await prisma.searchTerm.findMany();
  return all.filter((t) => !t.query.startsWith("__"));
}

// Expose search terms to client components (e.g. scraper terminal UI)
export async function getSearchTermsAction(): Promise<{ id: string; query: string }[]> {
  const terms = await getUserSearchTerms();
  return terms.map((t) => ({ id: t.id, query: t.query }));
}

// Run a keyword-based scraper across all user search terms, tolerating per-term failures
async function runSearchTermScraper(
  scraperFn: (query: string) => Promise<import("@/lib/scrapers/types").ScrapedJob[]>
): Promise<ScraperSaveResult> {
  const searchTerms = await getUserSearchTerms();

  if (searchTerms.length === 0) {
    return { jobsFound: 0, jobsNew: 0, error: "No search terms configured" };
  }

  let totalFound = 0;
  let totalNew = 0;
  const warnings: string[] = [];

  for (const term of searchTerms) {
    try {
      const jobs = await scraperFn(term.query);
      const result = await saveScrapedJobs(jobs, term.id);
      totalFound += result.jobsFound;
      totalNew += result.jobsNew;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      warnings.push(`"${term.query}" failed: ${msg}`);
    }
  }

  // If every term failed, report as error
  if (warnings.length === searchTerms.length) {
    return { jobsFound: 0, jobsNew: 0, error: warnings[0] };
  }

  return {
    jobsFound: totalFound,
    jobsNew: totalNew,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function runAdzunaScrape(): Promise<ScraperSaveResult> {
  const result = await runSearchTermScraper(scrapeAdzuna);
  revalidatePath("/");
  return result;
}

export async function runJSearchScrape(): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, error: "No search terms configured" };
  }

  const systemTermId = await getOrCreateSystemTerm("jsearch");

  // Combine all search terms into one OR query (e.g. "Product Designer OR UX Designer")
  const combined = queries.join(" OR ");

  // Run two searches: remote + Austin, merge results
  const [remoteJobs, austinJobs] = await Promise.allSettled([
    scrapeJSearch({
      query: `remote ${combined} jobs`,
      workFromHome: true,
    }),
    scrapeJSearch({
      query: `${combined} jobs in Austin`,
      location: "Austin, United States",
    }),
  ]);

  const allJobs = [
    ...(remoteJobs.status === "fulfilled" ? remoteJobs.value : []),
    ...(austinJobs.status === "fulfilled" ? austinJobs.value : []),
  ];

  // Collect warnings for any failed searches
  const warnings: string[] = [];
  if (remoteJobs.status === "rejected") warnings.push(`Remote search failed: ${remoteJobs.reason}`);
  if (austinJobs.status === "rejected") warnings.push(`Austin search failed: ${austinJobs.reason}`);

  // If both failed, report as error
  if (allJobs.length === 0 && warnings.length === 2) {
    return { jobsFound: 0, jobsNew: 0, error: warnings.join("; ") };
  }

  const result = await saveScrapedJobs(allJobs, systemTermId);
  revalidatePath("/");
  return {
    ...result,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function runDribbbleScrape(): Promise<ScraperSaveResult> {
  const result = await runSearchTermScraper(scrapeDribbble);
  revalidatePath("/");
  return result;
}

export async function runWeLoveProductScrape(): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, error: "No search terms configured" };
  }

  const systemTermId = await getOrCreateSystemTerm("weloveproduct");
  const jobs = await scrapeWeLoveProduct(queries);
  const result = await saveScrapedJobs(jobs, systemTermId);
  revalidatePath("/");
  return result;
}

// Scrape all Greenhouse companies in parallel using Promise.allSettled
export async function runGreenhouseAllScrape(): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, error: "No search terms configured" };
  }

  const systemTermId = await getOrCreateSystemTerm("greenhouse");
  const slugs = SCRAPER_CONFIG.greenhouse.slugs;

  // Fetch all companies in parallel
  const results = await Promise.allSettled(
    slugs.map((slug) => scrapeGreenhouseCompany(slug, queries))
  );

  let totalFound = 0;
  let totalNew = 0;
  const warnings: string[] = [];

  // Save results sequentially to avoid DB conflicts
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const slug = slugs[i];
    if (result.status === "fulfilled") {
      const saved = await saveScrapedJobs(result.value, systemTermId);
      totalFound += saved.jobsFound;
      totalNew += saved.jobsNew;
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : "Unknown error";
      warnings.push(`${slug}: ${msg}`);
    }
  }

  revalidatePath("/");

  if (warnings.length === slugs.length) {
    return { jobsFound: 0, jobsNew: 0, error: "All companies failed" };
  }

  return {
    jobsFound: totalFound,
    jobsNew: totalNew,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// Scrape all Lever companies in parallel using Promise.allSettled
export async function runLeverAllScrape(): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, error: "No search terms configured" };
  }

  const systemTermId = await getOrCreateSystemTerm("lever");
  const slugs = SCRAPER_CONFIG.lever.slugs;

  const results = await Promise.allSettled(
    slugs.map((slug) => scrapeLeverCompany(slug, queries))
  );

  let totalFound = 0;
  let totalNew = 0;
  const warnings: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const slug = slugs[i];
    if (result.status === "fulfilled") {
      const saved = await saveScrapedJobs(result.value, systemTermId);
      totalFound += saved.jobsFound;
      totalNew += saved.jobsNew;
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : "Unknown error";
      warnings.push(`${slug}: ${msg}`);
    }
  }

  revalidatePath("/");

  if (warnings.length === slugs.length) {
    return { jobsFound: 0, jobsNew: 0, error: "All companies failed" };
  }

  return {
    jobsFound: totalFound,
    jobsNew: totalNew,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// Scrape UIUXJobsBoard — curated design board, filters by user search terms
export async function runUiUxJobsBoardScrape(): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, error: "No search terms configured" };
  }

  const systemTermId = await getOrCreateSystemTerm("uiuxjobsboard");
  const jobs = await scrapeUiUxJobsBoard(queries);
  const result = await saveScrapedJobs(jobs, systemTermId);
  revalidatePath("/");
  return result;
}

// Scrape Remotive — joins all user search terms into one API call (rate limit: 4/day)
export async function runRemotiveScrape(): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, error: "No search terms configured" };
  }

  const systemTermId = await getOrCreateSystemTerm("remotive");
  const jobs = await scrapeRemotive(queries);
  const result = await saveScrapedJobs(jobs, systemTermId);
  revalidatePath("/");
  return result;
}
