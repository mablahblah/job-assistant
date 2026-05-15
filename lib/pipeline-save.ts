import { prisma } from "@/lib/prisma";
import { classifyLocation } from "@/lib/location";

// Ensures a date string is a full ISO-8601 DateTime for Prisma (e.g. "2026-04-22" → "2026-04-22T00:00:00.000Z")
function toISODateTime(dateStr: string): string {
  if (dateStr.includes("T")) return dateStr;
  return `${dateStr}T00:00:00.000Z`;
}

// Statuses safe to overwrite when a repost is found
const REPLACEABLE_STATUSES = new Set(["backlog", "too far", "expired", "won't apply", "rejected"]);

// Shape the pipeline passes to the save function
export interface SaveableJob {
  url: string;           // final resolved URL (canonical destination)
  title: string;
  companyName: string;
  location: string;
  workMode: string;
  postedAt: string;      // raw date string, no Date round-trip
  salaryRange: string;
  source: string;        // which collector found this job
  parser: string | null; // which parser processed it, null if unparsed
  originalUrl: string | null; // original collector URL, only set when resolution changed it
}

export interface PipelineSaveResult {
  saved: number;
  skipped: number;
  reposted: number;
  savedJobIds: string[];
}

// Saves parsed jobs to DB with dedup, company upsert, and auto-classification.
// mode "search": auto-classify (expired → too far → backlog).
// mode "external": always backlog regardless of age or location.
export async function saveParsedJobs(
  jobs: SaveableJob[],
  mode: "search" | "external",
): Promise<PipelineSaveResult> {
  let saved = 0;
  let skipped = 0;
  let reposted = 0;
  const savedJobIds: string[] = [];

  // Pre-fetch blocked URLs so deleted jobs don't re-enter the DB
  const blockedUrls = new Set(
    (await prisma.blockedJob.findMany({ select: { url: true } })).map((b) => b.url),
  );

  for (const jobData of jobs) {
    // Skip URLs that were previously deleted
    if (blockedUrls.has(jobData.url)) {
      skipped++;
      continue;
    }

    // Skip incomplete records — can't dedup or upsert without these
    if (!jobData.title || !jobData.companyName) {
      skipped++;
      continue;
    }

    // Ensure the company row exists before linking the job to it
    const company = await prisma.company.upsert({
      where: { name: jobData.companyName },
      create: { name: jobData.companyName },
      update: {},
    });

    // 1. Exact URL dedup — same posting already in DB, nothing to do
    const existing = await prisma.job.findUnique({ where: { url: jobData.url } });
    if (existing) {
      skipped++;
      continue;
    }

    // 2. Company + title dedup — catches cross-board reposts of the same role
    const dupeRows = await prisma.job.findMany({
      where: { companyId: company.id, title: jobData.title },
      select: { id: true, title: true, status: true },
    });
    const existingDupe = dupeRows[0] ?? null;

    if (existingDupe) {
      if (!REPLACEABLE_STATUSES.has(existingDupe.status)) {
        // Job is in-progress — don't touch it
        skipped++;
        continue;
      }
      // Refresh the existing job with new posting data and mark it as a repost
      await prisma.job.update({
        where: { id: existingDupe.id },
        data: {
          url: jobData.url,
          postedAt: toISODateTime(jobData.postedAt),
          location: jobData.location,
          workMode: jobData.workMode,
          salaryRange: jobData.salaryRange,
          repost: true,
          source: jobData.source,
          parser: jobData.parser,
          originalUrl: jobData.originalUrl,
        },
      });
      savedJobIds.push(existingDupe.id);
      reposted++;
      continue;
    }

    // 3. Brand new job — determine status before persisting
    const status = (() => {
      if (mode === "external") return "backlog";
      const ageMs = Date.now() - new Date(jobData.postedAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays >= 8) return "expired";
      const loc = classifyLocation(jobData.workMode, jobData.location);
      if (loc.tooFar) return "too far";
      return "backlog";
    })();

    // locationFlagged only applies when auto-classification set the job to "too far"
    const locationFlagged = mode !== "external" && status === "too far";

    const job = await prisma.job.create({
      data: {
        companyId: company.id,
        title: jobData.title,
        url: jobData.url,
        location: jobData.location,
        workMode: jobData.workMode,
        postedAt: toISODateTime(jobData.postedAt),
        salaryRange: jobData.salaryRange,
        status,
        locationFlagged,
        source: jobData.source,
        parser: jobData.parser,
        originalUrl: jobData.originalUrl,
      },
    });

    savedJobIds.push(job.id);
    saved++;
  }

  return { saved, skipped, reposted, savedJobIds };
}
