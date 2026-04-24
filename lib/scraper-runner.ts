// lib/scraper-runner.ts
// Runs scrapers and saves results — no Next.js dependency, safe for CLI use
import { prisma } from "@/lib/prisma";
import {
  saveScrapedJobs,
  getOrCreateSystemTerm,
  type ScraperSaveResult,
} from "@/lib/scraper-save";
import { scrapeAdzuna } from "@/lib/scrapers/adzuna";
import { scrapeJSearch } from "@/lib/scrapers/jsearch";
import { scrapeGreenhouseCompany } from "@/lib/scrapers/greenhouse";
import { scrapeLeverCompany } from "@/lib/scrapers/lever";
import { scrapeDribbble } from "@/lib/scrapers/dribbble";
import { scrapeWeLoveProduct } from "@/lib/scrapers/weloveproduct";
import { scrapeUiUxJobsBoard } from "@/lib/scrapers/uiuxjobsboard";
import { SCRAPER_CONFIG } from "@/lib/scrapers/scraper-config";
import type { ScrapedJob } from "@/lib/scrapers/types";

// returns user-created search terms (filters out __ system terms)
export async function getUserSearchTerms() {
  const all = await prisma.searchTerm.findMany();
  return all.filter((t) => !t.query.startsWith("__"));
}

// runs a keyword-based scraper once per user search term, tolerating per-term failures
// dryRun: scrape but skip saving to DB — useful for testing scrapers
async function runSearchTermScraper(
  scraperFn: (query: string) => Promise<ScrapedJob[]>,
  dryRun = false,
): Promise<ScraperSaveResult> {
  const searchTerms = await getUserSearchTerms();
  if (searchTerms.length === 0) {
    return { jobsFound: 0, jobsNew: 0, jobsReposted: 0, error: "No search terms configured" };
  }

  let totalFound = 0;
  let totalNew = 0;
  let totalReposted = 0;
  const warnings: string[] = [];

  for (const term of searchTerms) {
    try {
      const jobs = await scraperFn(term.query);
      if (dryRun) {
        totalFound += jobs.length;
      } else {
        const result = await saveScrapedJobs(jobs, term.id);
        totalFound += result.jobsFound;
        totalNew += result.jobsNew;
        totalReposted += result.jobsReposted;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      warnings.push(`"${term.query}" failed: ${msg}`);
    }
  }

  if (warnings.length === searchTerms.length) {
    return { jobsFound: 0, jobsNew: 0, jobsReposted: 0, error: warnings[0] };
  }

  return {
    jobsFound: totalFound,
    jobsNew: totalNew,
    jobsReposted: totalReposted,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// runs a multi-source scraper (Greenhouse/Lever pattern) across all configured slugs
// dryRun: scrape but skip saving to DB
async function runMultiSourceScraper(
  name: string,
  slugs: readonly string[],
  scrapeFn: (slug: string, queries: string[]) => Promise<ScrapedJob[]>,
  dryRun = false,
): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, jobsReposted: 0, error: "No search terms configured" };
  }

  // skip creating system term in dry-run — we won't save anything
  const systemTermId = dryRun ? "" : await getOrCreateSystemTerm(name);
  const results = await Promise.allSettled(
    slugs.map((slug) => scrapeFn(slug, queries)),
  );

  let totalFound = 0;
  let totalNew = 0;
  let totalReposted = 0;
  const warnings: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      if (dryRun) {
        totalFound += result.value.length;
      } else {
        const saved = await saveScrapedJobs(result.value, systemTermId);
        totalFound += saved.jobsFound;
        totalNew += saved.jobsNew;
        totalReposted += saved.jobsReposted;
      }
    } else {
      const msg =
        result.reason instanceof Error
          ? result.reason.message
          : "Unknown error";
      warnings.push(`${slugs[i]}: ${msg}`);
    }
  }

  if (warnings.length === slugs.length) {
    return { jobsFound: 0, jobsNew: 0, jobsReposted: 0, error: `All ${name} companies failed` };
  }

  return {
    jobsFound: totalFound,
    jobsNew: totalNew,
    jobsReposted: totalReposted,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// --- Individual scraper runners ---

export async function runAdzuna(dryRun = false): Promise<ScraperSaveResult> {
  return runSearchTermScraper(scrapeAdzuna, dryRun);
}

export async function runJSearch(dryRun = false): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, jobsReposted: 0, error: "No search terms configured" };
  }

  const systemTermId = dryRun ? "" : await getOrCreateSystemTerm("jsearch");
  const combined = queries.join(" OR ");

  // two parallel searches: remote jobs + Austin-area jobs
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

  const warnings: string[] = [];
  if (remoteJobs.status === "rejected")
    warnings.push(`Remote search failed: ${remoteJobs.reason}`);
  if (austinJobs.status === "rejected")
    warnings.push(`Austin search failed: ${austinJobs.reason}`);

  if (allJobs.length === 0 && warnings.length === 2) {
    return { jobsFound: 0, jobsNew: 0, jobsReposted: 0, error: warnings.join("; ") };
  }

  if (dryRun) {
    return { jobsFound: allJobs.length, jobsNew: 0, jobsReposted: 0, ...(warnings.length > 0 ? { warnings } : {}) };
  }

  const result = await saveScrapedJobs(allJobs, systemTermId);
  return { ...result, ...(warnings.length > 0 ? { warnings } : {}) };
}

export async function runDribbble(dryRun = false): Promise<ScraperSaveResult> {
  return runSearchTermScraper(scrapeDribbble, dryRun);
}

export async function runWeLoveProduct(dryRun = false): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, jobsReposted: 0, error: "No search terms configured" };
  }
  if (dryRun) {
    const jobs = await scrapeWeLoveProduct(queries);
    return { jobsFound: jobs.length, jobsNew: 0, jobsReposted: 0 };
  }
  const systemTermId = await getOrCreateSystemTerm("weloveproduct");
  const jobs = await scrapeWeLoveProduct(queries);
  return saveScrapedJobs(jobs, systemTermId);
}

export async function runGreenhouse(dryRun = false): Promise<ScraperSaveResult> {
  return runMultiSourceScraper(
    "greenhouse",
    SCRAPER_CONFIG.greenhouse.slugs,
    scrapeGreenhouseCompany,
    dryRun,
  );
}

export async function runLever(dryRun = false): Promise<ScraperSaveResult> {
  return runMultiSourceScraper(
    "lever",
    SCRAPER_CONFIG.lever.slugs,
    scrapeLeverCompany,
    dryRun,
  );
}

export async function runUiUxJobsBoard(dryRun = false): Promise<ScraperSaveResult> {
  const queries = (await getUserSearchTerms()).map((t) => t.query);
  if (queries.length === 0) {
    return { jobsFound: 0, jobsNew: 0, jobsReposted: 0, error: "No search terms configured" };
  }
  if (dryRun) {
    const jobs = await scrapeUiUxJobsBoard(queries);
    return { jobsFound: jobs.length, jobsNew: 0, jobsReposted: 0 };
  }
  const systemTermId = await getOrCreateSystemTerm("uiuxjobsboard");
  const jobs = await scrapeUiUxJobsBoard(queries);
  return saveScrapedJobs(jobs, systemTermId);
}

// --- Master runner ---

export interface ScrapeAllResult {
  total: { jobsFound: number; jobsNew: number; jobsReposted: number };
  scrapers: Record<string, ScraperSaveResult>;
}

// runs every enabled scraper sequentially and returns combined results
// dryRun: scrape but skip all DB writes — for testing scrapers
export async function runAllScrapers(dryRun = false): Promise<ScrapeAllResult> {
  const config = SCRAPER_CONFIG;
  const scrapers: Record<string, ScraperSaveResult> = {};
  let totalFound = 0;
  let totalNew = 0;
  let totalReposted = 0;

  const runners: {
    name: string;
    fn: () => Promise<ScraperSaveResult>;
    enabled: boolean;
  }[] = [
    { name: "adzuna", fn: () => runAdzuna(dryRun), enabled: config.adzuna.enabled },
    { name: "jsearch", fn: () => runJSearch(dryRun), enabled: config.jsearch.enabled },
    { name: "dribbble", fn: () => runDribbble(dryRun), enabled: config.dribbble.enabled },
    {
      name: "weloveproduct",
      fn: () => runWeLoveProduct(dryRun),
      enabled: config.weloveproduct.enabled,
    },
    {
      name: "greenhouse",
      fn: () => runGreenhouse(dryRun),
      enabled: config.greenhouse.enabled,
    },
    { name: "lever", fn: () => runLever(dryRun), enabled: config.lever.enabled },
    {
      name: "uiuxjobsboard",
      fn: () => runUiUxJobsBoard(dryRun),
      enabled: config.uiuxjobsboard.enabled,
    },
  ];

  for (const { name, fn, enabled } of runners) {
    if (!enabled) {
      scrapers[name] = { jobsFound: 0, jobsNew: 0, jobsReposted: 0, error: "disabled" };
      continue;
    }
    console.error(`[scrape${dryRun ? " dry-run" : ""}] Running ${name}...`);
    try {
      scrapers[name] = await fn();
      totalFound += scrapers[name].jobsFound;
      totalNew += scrapers[name].jobsNew;
      totalReposted += scrapers[name].jobsReposted;
      console.error(
        `[scrape] ${name}: found=${scrapers[name].jobsFound} new=${scrapers[name].jobsNew} reposted=${scrapers[name].jobsReposted}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      scrapers[name] = { jobsFound: 0, jobsNew: 0, jobsReposted: 0, error: msg };
      console.error(`[scrape] ${name} failed: ${msg}`);
    }
  }

  return { total: { jobsFound: totalFound, jobsNew: totalNew, jobsReposted: totalReposted }, scrapers };
}
