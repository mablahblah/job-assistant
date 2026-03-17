"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { runScraping, OrchestratorResult } from "@/lib/scraper-orchestrator";

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

export async function deleteAllJobs() {
  await prisma.job.deleteMany();
  await prisma.company.deleteMany();
  await prisma.scrapingRun.deleteMany();
  revalidatePath("/");
}
