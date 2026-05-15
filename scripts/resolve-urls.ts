import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { prisma } from '../lib/prisma';
import { resolveJobUrl, formatResults, type ResolutionChain } from '../lib/url-resolver';

const CONCURRENCY = 5;
const OUTPUT_DIR = 'data';

// Prints live progress to stderr (same line, updates in place)
function printProgress(results: ResolutionChain[], total: number) {
  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }
  const parts = ['resolved', 'dead_end', 'uncertain', 'error', 'unresolved']
    .filter(s => counts[s])
    .map(s => `${s}: ${counts[s]}`)
    .join(', ');
  process.stderr.write(`\r  ${results.length}/${total} [${parts}]`);
}

async function main() {
  // Load all job URLs from the database
  const jobs = await prisma.job.findMany({
    select: { id: true, url: true },
  });
  console.error(`Resolving ${jobs.length} job URLs (concurrency: ${CONCURRENCY})...\n`);

  // Launch a single browser shared across all workers
  const browser = await chromium.launch({ headless: false });

  // Worker pool: each job gets a fresh browser context to avoid state accumulation
  const results: ResolutionChain[] = [];
  let index = 0;

  async function worker() {
    while (index < jobs.length) {
      const job = jobs[index++];
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        const chain = await resolveJobUrl(job.url, job.id, page);
        results.push(chain);
        printProgress(results, jobs.length);
      } finally {
        await context.close();
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  } finally {
    await browser.close();
  }
  process.stderr.write('\n\n');

  // Print frequency distribution to stdout
  console.log(formatResults(results));

  // Save full chain data for reuse in feature #4
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    `${OUTPUT_DIR}/url-resolution-chains.json`,
    JSON.stringify(results, null, 2),
  );
  console.error(`Chain data saved to ${OUTPUT_DIR}/url-resolution-chains.json`);

  // Save uncertain/unresolved URLs for manual review
  const reviewable = results.filter(r => r.status === 'uncertain' || r.status === 'unresolved');
  if (reviewable.length > 0) {
    const urls = reviewable.map(r => r.startUrl).join('\n');
    writeFileSync(`${OUTPUT_DIR}/url-resolution-review.txt`, urls + '\n');
    console.error(`${reviewable.length} URLs saved to ${OUTPUT_DIR}/url-resolution-review.txt for manual review`);
  }
}

main().catch(console.error);
