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

// Statuses that are safe to replace when a duplicate is found (not actively in-progress)
const REPLACEABLE_STATUSES = new Set(["backlog", "too far", "expired", "won't apply", "rejected"]);

export async function saveScrapedJobs(
  jobs: ScrapedJob[],
  searchTermId: string
): Promise<ScraperSaveResult> {
  let jobsNew = 0;

  // Pre-fetch all blocked URLs so deleted jobs don't get re-imported
  const blockedUrls = new Set(
    (await prisma.blockedJob.findMany({ select: { url: true } })).map((b) => b.url)
  );

  for (const jobData of jobs) {
    if (blockedUrls.has(jobData.url)) {
      console.log(`[scraper-save] Skipped blocked URL: ${jobData.url} (previously deleted)`);
      continue;
    }

    const company = await prisma.company.upsert({
      where: { name: jobData.companyName },
      create: { name: jobData.companyName },
      update: {},
    });

    // 1. Exact URL match — skip if this URL is already in the DB
    let job = await prisma.job.findUnique({ where: { url: jobData.url } });
    if (job) {
      console.log(`[scraper-save] Skipped URL dupe: "${jobData.title}" at ${jobData.companyName}`);
    }
    if (!job) {
      // 2. Company + title match — catch cross-board dupes and reposts (SQLite LIKE is case-insensitive for ASCII)
      const dupeRows = await prisma.$queryRawUnsafe<{ id: string; title: string; status: string }[]>(
        `SELECT id, title, status FROM Job WHERE companyId = ? AND title LIKE ?`,
        company.id,
        jobData.title
      );
      const existingDupe = dupeRows[0] ?? null;

      if (existingDupe) {
        if (!REPLACEABLE_STATUSES.has(existingDupe.status)) {
          // In-progress job — don't touch it
          console.log(`[scraper-save] Skipped dupe "${jobData.title}" at ${jobData.companyName} — existing job is ${existingDupe.status}`);
          continue;
        }
        // Replace stale dupe with fresh posting (cascade deletes JobSource records)
        await prisma.job.delete({ where: { id: existingDupe.id } });
        console.log(`[scraper-save] Replacing dupe "${existingDupe.title}" (${existingDupe.status}) with fresh posting`);
      }

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
