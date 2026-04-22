// scripts/scrape.ts
// Runs all enabled scrapers, saves results to DB, outputs JSON summary to stdout.
// Usage: npx tsx scripts/scrape.ts [--dry-run]
// --dry-run: test scrapers without saving to DB
import "dotenv/config"; // load .env vars (Next.js does this automatically, CLI scripts don't)
import { runAllScrapers } from "@/lib/scraper-runner";
import { prisma } from "@/lib/prisma";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) console.error("[scrape] DRY RUN — nothing will be saved to DB");

  const result = await runAllScrapers(dryRun);

  // in dry-run mode, skip the DB query for new jobs since we didn't save any
  if (dryRun) {
    console.log(JSON.stringify({ ...result, dryRun: true }, null, 2));
    process.exit(0);
  }

  // fetch the new jobs that were just created (last 5 minutes as a safe window)
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const newJobs = await prisma.job.findMany({
    where: { createdAt: { gte: since } },
    include: { company: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const output = {
    ...result,
    newJobs: newJobs.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company.name,
      url: j.url,
      location: j.location,
      workMode: j.workMode,
      salaryRange: j.salaryRange,
      status: j.status,
      postedAt: j.postedAt.toISOString(),
    })),
  };

  // clean JSON to stdout — Claude reads this
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
