import { prisma } from "@/lib/prisma";
import { enrichCompany } from "@/lib/company-enrichment";

// Maps the statuses that trigger a TWC work search log entry to their human-readable activity labels
const TRIGGER_STATUS_MAP: Record<string, string> = {
  "app. sent": "Applied for job",
  "screening": "Had phone screen",
  "interview": "Had interview",
};

// Creates a WorkSearchEntry when a job moves to a qualifying status, then fire-and-forget
// enriches the job's company with address/phone/website from Google Places.
// No-op for non-qualifying statuses (backlog, rejected, etc.).
// Caller is responsible for revalidatePath — this function only handles DB writes.
export async function logWorkSearchActivity(
  jobId: string,
  newStatus: string
): Promise<void> {
  const activityType = TRIGGER_STATUS_MAP[newStatus];
  if (!activityType) return; // not a qualifying status — nothing to log

  // Load the job's company so we can pass companyId + location to enrichment
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { companyId: true, location: true },
  });

  await prisma.workSearchEntry.create({
    data: {
      jobId,
      date: new Date(),
      activityType,
      // result defaults to "Application filed" via Prisma schema default
    },
  });

  if (job) {
    // Check if company has already been enriched — skip pending if so
    const company = await prisma.company.findUnique({
      where: { id: job.companyId },
      select: { enrichedAt: true },
    });
    if (!company?.enrichedAt) {
      // Set pending synchronously so the UI can show "in progress" before enrichment resolves
      await prisma.company.update({
        where: { id: job.companyId },
        data: { enrichmentStatus: "pending" },
      });
    }
    // Fire-and-forget: enrichment runs asynchronously and never blocks the status change
    enrichCompany(job.companyId, job.location).catch(console.error);
  }
}
