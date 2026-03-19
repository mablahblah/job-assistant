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

// Get user search terms (excludes system terms starting with __)
async function getUserSearchTerms() {
  const all = await prisma.searchTerm.findMany();
  return all.filter((t) => !t.query.startsWith("__"));
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
  const result = await runSearchTermScraper(scrapeJSearch);
  revalidatePath("/");
  return result;
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

export async function runGreenhouseCompanyScrape(slug: string): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, error: "No search terms configured" };
  }

  const systemTermId = await getOrCreateSystemTerm("greenhouse");
  const jobs = await scrapeGreenhouseCompany(slug, queries);
  const result = await saveScrapedJobs(jobs, systemTermId);
  revalidatePath("/");
  return result;
}

export async function runLeverCompanyScrape(slug: string): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, error: "No search terms configured" };
  }

  const systemTermId = await getOrCreateSystemTerm("lever");
  const jobs = await scrapeLeverCompany(slug, queries);
  const result = await saveScrapedJobs(jobs, systemTermId);
  revalidatePath("/");
  return result;
}
