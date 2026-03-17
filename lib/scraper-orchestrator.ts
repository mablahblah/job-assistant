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
    const scraped = await scrapeAdzuna("Product Designer");

    let jobsNew = 0;

    for (const job of scraped) {
      // Upsert company — create with placeholders if new, otherwise leave existing ratings intact
      const company = await prisma.company.upsert({
        where: { name: job.companyName },
        create: { name: job.companyName, ...PLACEHOLDER_RATINGS },
        update: {},
      });

      // Skip if we already have this job (deduplicate by URL)
      const existing = await prisma.job.findFirst({ where: { url: job.url } });
      if (existing) continue;

      await prisma.job.create({
        data: {
          companyId: company.id,
          title: job.title,
          url: job.url,
          location: job.location,
          workMode: job.workMode,
          postedAt: job.postedAt,
          salaryRange: job.salaryRange,
          benefits: PLACEHOLDER_BENEFITS,
          status: "new",
        },
      });

      jobsNew++;
    }

    await prisma.scrapingRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        jobsFound: scraped.length,
        jobsNew,
        completedAt: new Date(),
      },
    });

    return { runId: run.id, jobsFound: scraped.length, jobsNew };
  } catch (err) {
    await prisma.scrapingRun.update({
      where: { id: run.id },
      data: { status: "failed", completedAt: new Date() },
    });
    throw err;
  }
}
