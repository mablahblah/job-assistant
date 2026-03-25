"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { runScraping, OrchestratorResult } from "@/lib/scraper-orchestrator";

export async function setJobStatus(jobId: string, status: string) {
  // update status, record when it changed, and clear location flag on manual override
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { status, modifiedAt: new Date(), locationFlagged: false },
  });
  console.log(`[status-change] job=${job.id} status=${status} modifiedAt=${job.modifiedAt?.toISOString()}`);
  revalidatePath("/");
}

export async function toggleJobStatus(jobId: string) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const newStatus = job.status === "new" ? "applied" : "new";
  await prisma.job.update({
    where: { id: jobId },
    data: { status: newStatus },
  });
  revalidatePath("/");
}

export async function runScrape(): Promise<OrchestratorResult> {
  const result = await runScraping();
  revalidatePath("/");
  return result;
}

export async function addSearchTerm(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return;
  await prisma.searchTerm.upsert({
    where: { query: trimmed },
    update: {},
    create: { query: trimmed },
  });
  revalidatePath("/");
}

export async function removeSearchTerm(id: string) {
  await prisma.searchTerm.delete({ where: { id } });
  revalidatePath("/");
}

export async function updateCompanyScores(
  companyId: string,
  scores: {
    employeeSatisfaction: number | null;
    customerSatisfaction: number | null;
    workLifeBalance: number | null;
    politicalAlignment: number | null;
    benefits: number | null;
  }
) {
  await prisma.company.update({
    where: { id: companyId },
    data: scores,
  });
  revalidatePath("/companies");
  revalidatePath("/");
}

export async function deleteCompany(companyId: string) {
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  revalidatePath("/companies");
  revalidatePath("/");
}

// Accepts a JSON array of company scores from Claude and overwrites scores for each matched company.
// Returns a summary of what was updated and any companies that couldn't be matched.
export async function importCompanyScores(jsonString: string): Promise<{
  success: boolean
  updated: string[]
  notFound: string[]
  error?: string
}> {
  let parsed: unknown
  try {
    // Strip markdown code fences if present
    const cleaned = jsonString.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "")
    parsed = JSON.parse(cleaned)
  } catch {
    return { success: false, updated: [], notFound: [], error: "Invalid JSON" }
  }

  if (!Array.isArray(parsed)) {
    return { success: false, updated: [], notFound: [], error: "Expected a JSON array" }
  }

  const scoreKeys = [
    "employeeSatisfaction",
    "customerSatisfaction",
    "workLifeBalance",
    "politicalAlignment",
    "benefits",
  ] as const

  const updated: string[] = []
  const notFound: string[] = []

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || !("company" in entry)) continue
    const name = String(entry.company)

    const company = await prisma.company.findUnique({ where: { name } })
    if (!company) {
      notFound.push(name)
      continue
    }

    const scores: Record<string, number | null> = {}
    for (const key of scoreKeys) {
      if (key in entry) {
        const val = (entry as Record<string, unknown>)[key]
        scores[key] = typeof val === "number" && val >= 1 && val <= 5 ? val : null
      }
    }

    await prisma.company.update({ where: { id: company.id }, data: scores })
    updated.push(name)
  }

  revalidatePath("/companies")
  revalidatePath("/")
  return { success: true, updated, notFound }
}

// Auto-expire backlog jobs that are 8+ days old (runs on page load)
export async function expireOldBacklogJobs() {
  const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await prisma.job.updateMany({
    where: { status: "backlog", postedAt: { lt: cutoff } },
    data: { status: "expired", modifiedAt: new Date() },
  });
}

// Hard-delete a single job and block its URL so it won't reappear in future scrapes
export async function deleteJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;

  // Block the URL before deleting so the scraper skips it next time
  await prisma.blockedJob.upsert({
    where: { url: job.url },
    create: { url: job.url },
    update: {},
  });

  await prisma.job.delete({ where: { id: jobId } });
  console.log(`[delete-job] Deleted job id=${jobId} title="${job.title}" url=${job.url} — URL blocked from future scrapes`);
  revalidatePath("/");
}
