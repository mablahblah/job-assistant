"use server";

import { prisma } from "@/lib/prisma";
import { type ScrapedJob } from "@/lib/scrapers/types";
import { classifyLocation } from "@/lib/location";

export interface ScraperSaveResult {
  jobsFound: number;
  jobsNew: number;
  error?: string;
  warnings?: string[];
}

export async function getOrCreateSystemTerm(name: string): Promise<string> {
  const query = `__${name}__`;
  const term = await prisma.searchTerm.upsert({
    where: { query },
    create: { query },
    update: {},
  });
  return term.id;
}

export async function saveScrapedJobs(
  jobs: ScrapedJob[],
  searchTermId: string
): Promise<ScraperSaveResult> {
  let jobsNew = 0;

  for (const jobData of jobs) {
    const company = await prisma.company.upsert({
      where: { name: jobData.companyName },
      create: { name: jobData.companyName },
      update: {},
    });

    let job = await prisma.job.findUnique({ where: { url: jobData.url } });
    if (!job) {
      try {
        job = await prisma.job.create({
          data: {
            companyId: company.id,
            title: jobData.title,
            url: jobData.url,
            location: jobData.location,
            workMode: jobData.workMode,
            postedAt: jobData.postedAt,
            salaryRange: jobData.salaryRange,
            // Auto-classify on scrape: expired (8+ days) → too far → backlog
            ...(() => {
              const ageMs = Date.now() - new Date(jobData.postedAt).getTime();
              const ageDays = ageMs / (1000 * 60 * 60 * 24);
              if (ageDays >= 8) return { status: "expired" };
              const result = classifyLocation(jobData.workMode, jobData.location);
              if (result.tooFar) return { status: "too far", locationFlagged: result.flagged };
              return { status: "backlog" };
            })(),
          },
        });
        jobsNew++;
      } catch {
        job = await prisma.job.findUnique({ where: { url: jobData.url } });
        if (!job) continue;
      }
    }

    await prisma.jobSource.upsert({
      where: { jobId_searchTermId: { jobId: job.id, searchTermId } },
      create: { jobId: job.id, searchTermId },
      update: {},
    });
  }

  return { jobsFound: jobs.length, jobsNew };
}
