// One-off script: set repostedAt on 5 old jobs for visual testing of the RP pill
// Run: npx tsx scripts/seed-repost-dates.ts
// Revert: npx tsx scripts/seed-repost-dates.ts --revert

import { prisma } from "../lib/prisma";

async function main() {
  const revert = process.argv.includes("--revert");

  if (revert) {
    // Clear repostedAt on all jobs (no jobs should have it yet outside this script)
    const result = await prisma.job.updateMany({
      where: { repostedAt: { not: null } },
      data: { repostedAt: null },
    });
    console.log(`Reverted ${result.count} job(s) — cleared repostedAt.`);
    return;
  }

  // Find 5 jobs with firstPublished 8+ days ago
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 8);

  const candidates = await prisma.job.findMany({
    where: { firstPublished: { lte: cutoff } },
    orderBy: { firstPublished: "desc" },
    take: 5,
    select: { id: true, title: true, firstPublished: true },
  });

  if (candidates.length === 0) {
    console.log("No jobs found with firstPublished 8+ days ago.");
    return;
  }

  for (const job of candidates) {
    // Set repostedAt to one day after firstPublished
    const repostedAt = new Date(job.firstPublished);
    repostedAt.setDate(repostedAt.getDate() + 1);

    await prisma.job.update({
      where: { id: job.id },
      data: { repostedAt },
    });

    console.log(`  ${job.title} — repostedAt set to ${repostedAt.toISOString().slice(0, 10)}`);
  }

  console.log(`\nSeeded ${candidates.length} job(s). Revert with: npx tsx scripts/seed-repost-dates.ts --revert`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
