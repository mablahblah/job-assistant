// One-time cleanup: remove backlog/disqualified jobs and orphaned companies.
// Keeps active jobs and work search log entries intact.
// Usage: npx tsx scripts/cleanup-db.ts [--dry-run]

import { prisma } from "@/lib/prisma";

// Statuses that represent active/in-progress work — these jobs survive
const ACTIVE_STATUSES = new Set([
  "app. sent",
  "screening",
  "interview",
  "test",
  "offer",
]);

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("DRY RUN — no changes will be made\n");

  // 1. Find jobs to keep: active statuses + any job referenced by work search log
  const allJobs = await prisma.job.findMany({
    select: { id: true, status: true, title: true, company: { select: { name: true } } },
  });
  const logEntries = await prisma.workSearchEntry.findMany({
    select: { jobId: true },
  });
  const logJobIds = new Set(logEntries.map((e) => e.jobId));

  const keepJobs = allJobs.filter(
    (j) => ACTIVE_STATUSES.has(j.status) || logJobIds.has(j.id),
  );
  const deleteJobs = allJobs.filter(
    (j) => !ACTIVE_STATUSES.has(j.status) && !logJobIds.has(j.id),
  );

  console.log(`Total jobs: ${allJobs.length}`);
  console.log(`Keeping: ${keepJobs.length} (active + work log referenced)`);
  console.log(`Deleting: ${deleteJobs.length}\n`);

  for (const j of keepJobs) {
    console.log(`  KEEP: "${j.title}" at ${j.company.name} [${j.status}]`);
  }

  if (!dryRun) {
    const deleteJobIds = deleteJobs.map((j) => j.id);

    // 2. Delete the jobs
    const deletedJobs = await prisma.job.deleteMany({
      where: { id: { in: deleteJobIds } },
    });
    console.log(`Deleted ${deletedJobs.count} jobs`);

    // 4. Delete orphaned companies
    const companiesWithJobs = await prisma.job.findMany({
      select: { companyId: true },
      distinct: ["companyId"],
    });
    const activeCompanyIds = new Set(companiesWithJobs.map((j) => j.companyId));

    const allCompanies = await prisma.company.findMany({ select: { id: true, name: true } });
    const orphanedCompanies = allCompanies.filter((c) => !activeCompanyIds.has(c.id));

    if (orphanedCompanies.length > 0) {
      const deletedCompanies = await prisma.company.deleteMany({
        where: { id: { in: orphanedCompanies.map((c) => c.id) } },
      });
      console.log(`Deleted ${deletedCompanies.count} orphaned companies`);
    } else {
      console.log("No orphaned companies to delete");
    }

    console.log("\nCleanup complete.");
  } else {
    console.log("\nDry run complete — no changes made.");
  }
}

main()
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  });
