// One-off script: backfill missing WorkSearchEntry rows for jobs with qualifying statuses.
// The 20260612 dual-date migration cascade-deleted existing entries; this recreates them
// using each job's modifiedAt as the activity date.
// Run: npx tsx scripts/backfill-work-log.ts
// Dry run: npx tsx scripts/backfill-work-log.ts --dry-run

import { prisma } from "../lib/prisma";
import { TRIGGER_STATUS_MAP } from "../lib/work-search-log";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Find jobs with qualifying statuses that are missing work log entries
  const qualifyingJobs = await prisma.job.findMany({
    where: {
      status: { in: Object.keys(TRIGGER_STATUS_MAP) },
      workSearchEntries: { none: {} },
    },
    select: {
      id: true,
      title: true,
      status: true,
      modifiedAt: true,
      createdAt: true,
      company: { select: { name: true } },
    },
    orderBy: { modifiedAt: "asc" },
  });

  if (qualifyingJobs.length === 0) {
    console.log("No missing work log entries found — nothing to backfill.");
    return;
  }

  console.log(`Found ${qualifyingJobs.length} job(s) missing work log entries${dryRun ? " (dry run)" : ""}:\n`);

  let created = 0;
  for (const job of qualifyingJobs) {
    const activityType = TRIGGER_STATUS_MAP[job.status];
    // Use modifiedAt (when status was changed), fall back to createdAt
    const date = job.modifiedAt ?? job.createdAt;

    console.log(`  ${date.toISOString().slice(0, 10)} | ${activityType.padEnd(18)} | ${job.company.name} — ${job.title}`);

    if (!dryRun) {
      await prisma.workSearchEntry.create({
        data: {
          jobId: job.id,
          date,
          activityType,
        },
      });
      created++;
    }
  }

  if (dryRun) {
    console.log(`\nDry run complete. Run without --dry-run to create ${qualifyingJobs.length} entries.`);
  } else {
    console.log(`\nBackfilled ${created} work log entries.`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
