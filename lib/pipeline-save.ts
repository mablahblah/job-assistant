import { prisma } from "@/lib/prisma";
import { classifyLocation } from "@/lib/location";

// Ensures a date string is a full ISO-8601 DateTime for Prisma (e.g. "2026-04-22" → "2026-04-22T00:00:00.000Z")
export function toISODateTime(dateStr: string): string {
  if (dateStr.includes("T")) return dateStr;
  return `${dateStr}T00:00:00.000Z`;
}

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
  originalUrl: string | null; // original collector URL (provenance — where the collector found this job)
  geoStatus?: "backlog" | "too far" | "skip"; // pre-computed by geo classification stage
}

export interface PipelineSaveResult {
  saved: number;
  skipped: number;
  savedJobIds: string[];
}

// Saves new jobs to DB with company upsert and auto-classification.
// Deduplication is handled upstream by the three dedupe stages.
// mode "search": auto-classify (expired → too far → backlog).
// mode "external": always backlog regardless of age or location.
export async function saveParsedJobs(
  jobs: SaveableJob[],
  mode: "search" | "external",
): Promise<PipelineSaveResult> {
  let saved = 0;
  let skipped = 0;
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

    // Skip incomplete records — can't upsert without these
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

    // Determine status before persisting
    const status = (() => {
      if (mode === "external") return "backlog";
      const ageMs = Date.now() - new Date(jobData.postedAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays >= 8) return "expired";

      // Use pre-computed geo classification if available
      if (jobData.geoStatus === "too far") return "too far";
      if (jobData.geoStatus === "backlog") return "backlog";

      // Fallback: remote jobs still use the keyword-based filter
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

  return { saved, skipped, savedJobIds };
}
