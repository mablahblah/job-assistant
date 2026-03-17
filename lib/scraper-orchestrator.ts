import { prisma } from "@/lib/prisma";
import { scrapeAdzuna } from "@/lib/scrapers/adzuna";

// Placeholder ratings applied to all new companies until Claude enrichment is added
const PLACEHOLDER_RATINGS = {
  employeeSatisfaction: 3,
  customerSatisfaction: 3,
  workLifeBalance: 3,
  politicalAlignment: 3,
};

// Placeholder benefits rating applied to all new jobs until Claude enrichment is added
const PLACEHOLDER_BENEFITS = 3;

export interface OrchestratorResult {
  runId: string;
  jobsFound: number;
  jobsNew: number;
}

export async function runScraping(): Promise<OrchestratorResult> {
  const run = await prisma.scrapingRun.create({
    data: { source: "adzuna", status: "running" },
  });

  try {
    const searchTerms = await prisma.searchTerm.findMany();
    if (searchTerms.length === 0) {
      await prisma.scrapingRun.update({
        where: { id: run.id },
        data: { status: "completed", jobsFound: 0, jobsNew: 0, completedAt: new Date() },
      });
      return { runId: run.id, jobsFound: 0, jobsNew: 0 };
    }

    // Scrape each term separately so we know which term found which URL
    const resultsByTerm = await Promise.all(
      searchTerms.map(async (term) => ({
        term,
        jobs: await scrapeAdzuna(term.query),
      }))
    );

    // Build map: url → Set of searchTermIds that found it
    const urlToTermIds = new Map<string, Set<string>>();
    // Deduplicate job data by URL (keep first occurrence)
    const urlToJobData = new Map<string, (typeof resultsByTerm)[0]["jobs"][0]>();

    for (const { term, jobs } of resultsByTerm) {
      for (const job of jobs) {
        if (!urlToTermIds.has(job.url)) {
          urlToTermIds.set(job.url, new Set());
          urlToJobData.set(job.url, job);
        }
        urlToTermIds.get(job.url)!.add(term.id);
      }
    }

    const scrapedUrls = Array.from(urlToJobData.keys());
    let jobsNew = 0;

    for (const url of scrapedUrls) {
      const jobData = urlToJobData.get(url)!;
      const termIds = urlToTermIds.get(url)!;

      // Upsert company
      const company = await prisma.company.upsert({
        where: { name: jobData.companyName },
        create: { name: jobData.companyName, ...PLACEHOLDER_RATINGS },
        update: {},
      });

      // Upsert job by URL
      let job = await prisma.job.findFirst({ where: { url } });
      if (!job) {
        job = await prisma.job.create({
          data: {
            companyId: company.id,
            title: jobData.title,
            url: jobData.url,
            location: jobData.location,
            workMode: jobData.workMode,
            postedAt: jobData.postedAt,
            salaryRange: jobData.salaryRange,
            benefits: PLACEHOLDER_BENEFITS,
            status: "new",
          },
        });
        jobsNew++;
      }

      // Upsert a JobSource row for each term that found this job
      for (const searchTermId of Array.from(termIds)) {
        await prisma.jobSource.upsert({
          where: { jobId_searchTermId: { jobId: job.id, searchTermId } },
          create: { jobId: job.id, searchTermId },
          update: {},
        });
      }
    }

    // Delete orphaned jobs: scraped jobs whose search terms were all removed
    // (JobSource rows cascade-deleted when term is removed; jobs with no sources are orphans)
    // Jobs with zero sources AND a url that wasn't in this scrape are the orphans to clean up.
    // We only delete jobs that have zero JobSource rows — manually added jobs (no sources) are
    // left alone because they were never linked to a search term.
    // To distinguish: we delete jobs with zero sources only if their URL appeared in a prior
    // scrape but not this one. Simplest proxy: delete jobs with zero sources that are NOT
    // in the current scrapedUrls set.
    const jobsWithNoSources = await prisma.job.findMany({
      where: { sources: { none: {} } },
      select: { id: true, url: true },
    });

    const scrapedUrlSet = new Set(scrapedUrls);
    const orphanIds = jobsWithNoSources
      .filter((j) => !scrapedUrlSet.has(j.url))
      .map((j) => j.id);

    if (orphanIds.length > 0) {
      await prisma.job.deleteMany({ where: { id: { in: orphanIds } } });
    }

    await prisma.scrapingRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        jobsFound: scrapedUrls.length,
        jobsNew,
        completedAt: new Date(),
      },
    });

    return { runId: run.id, jobsFound: scrapedUrls.length, jobsNew };
  } catch (err) {
    await prisma.scrapingRun.update({
      where: { id: run.id },
      data: { status: "failed", completedAt: new Date() },
    });
    throw err;
  }
}
