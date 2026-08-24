// scripts/pipeline.ts
// Dry-run pipeline: DB jobs → resolve URLs → route → parse (Ashby) → score → output
// Run: npx tsx scripts/pipeline.ts

import { mkdirSync, writeFileSync } from "fs";
import { chromium } from "playwright";
import { prisma } from "../lib/prisma";
import {
  resolveJobUrl,
  type ResolutionChain,
} from "../lib/url-resolver";
import {
  isGreenlitDomain,
  routeByDomain,
  getParser,
} from "../lib/parsers/registry";
import { registerAllParsers } from "../lib/parsers/register-all";
import { calculateScore } from "../lib/scoring";
import type { Job, Company } from "../lib/types";
import type { PipelineJob, ParserResult } from "../lib/parsers/types";

// -- Config --
const CONCURRENCY = 3;
const SAMPLE_COUNT = 5;

// Register all available parsers
registerAllParsers();

// -- Main --
async function main() {
  // 1. Load all jobs from DB
  const dbJobs = await prisma.job.findMany({
    select: {
      id: true,
      url: true,
      title: true,
      company: { select: { name: true } },
    },
  });
  console.error(`\nLoaded ${dbJobs.length} jobs from DB\n`);

  // 2. Separate jobs already on a greenlit domain (skip resolution)
  const greenlitJobs: PipelineJob[] = [];
  const needsResolution: typeof dbJobs = [];

  for (const job of dbJobs) {
    const domain = isGreenlitDomain(job.url);
    if (domain) {
      greenlitJobs.push({
        id: job.id,
        url: job.url,
        title: job.title,
        companyName: job.company.name,
        finalUrl: job.url,
        finalDomain: domain,
        source: "greenlit-shortcut",
      });
    } else {
      needsResolution.push(job);
    }
  }
  console.error(
    `Greenlit shortcut: ${greenlitJobs.length} (skipped resolution)`,
  );
  console.error(`Needs resolution: ${needsResolution.length}\n`);

  // 3. Resolve URLs via Playwright (concurrent workers)
  // headless: false — some sites block headless browsers or redirect differently
  const browser = await chromium.launch({ headless: false });
  const chains: ResolutionChain[] = [];
  // Queue of jobs to resolve — workers pop from the front
  const resolveQueue = [...needsResolution];

  // Each worker grabs the next unresolved job until the list is exhausted
  async function resolveWorker() {
    while (resolveQueue.length > 0) {
      const job = resolveQueue.shift()!;
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        const chain = await resolveJobUrl(job.url, job.id, page);
        chains.push(chain);
        process.stderr.write(
          `\r  Resolving: ${chains.length}/${needsResolution.length}`,
        );
      } finally {
        await context.close();
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => resolveWorker()),
  );
  process.stderr.write("\n\n");

  // 4. Build PipelineJobs from resolved results
  const resolvedJobs: PipelineJob[] = [];
  const statusCounts: Record<string, number> = {};

  for (const chain of chains) {
    statusCounts[chain.status] = (statusCounts[chain.status] ?? 0) + 1;

    if (chain.status === "resolved") {
      const dbJob = needsResolution.find((j) => j.id === chain.jobId);
      if (!dbJob) continue;

      resolvedJobs.push({
        id: chain.jobId,
        url: chain.startUrl,
        title: dbJob.title,
        companyName: dbJob.company.name,
        finalUrl:
          chain.hops[chain.hops.length - 1]?.url ?? chain.startUrl,
        finalDomain: chain.finalDomain,
        source: "resolved",
      });
    }
  }

  // 5. Combine greenlit shortcuts + resolved jobs, then route to parsers
  const allRoutable = [...greenlitJobs, ...resolvedJobs];
  const { matched, unmatched } = routeByDomain(allRoutable);

  // 6. Parse jobs through their registered parsers
  const parseResults: Array<{ job: PipelineJob; result: ParserResult }> = [];

  for (const [domain, jobs] of Object.entries(matched)) {
    const parser = getParser(domain);
    if (!parser) continue;

    console.error(`Parsing ${jobs.length} ${domain} jobs...\n`);
    for (const job of jobs) {
      try {
        const result = await parser(job.finalUrl, browser);
        parseResults.push({ job, result });
        process.stderr.write(
          `\r  Parsed: ${parseResults.length}/${jobs.length}`,
        );
      } catch (err) {
        console.error(`Parse error for ${job.finalUrl}: ${err instanceof Error ? err.message : err}`);
      }
    }
    process.stderr.write("\n\n");
  }

  await browser.close();

  // 7. Score each successfully-parsed job with a clean-slate (no company data)
  const emptyCompany: Company = {
    id: "pipeline-dry-run",
    name: "",
    employeeSatisfaction: null,
    customerSatisfaction: null,
    workLifeBalance: null,
    politicalAlignment: null,
    note: null,
  };

  const scored = parseResults
    // Filter out dead posts (success but no fields extracted)
    .filter(({ result }) => result.success && Object.keys(result.fields).length > 0)
    .map(({ job, result }) => {
      // Build a minimal Job object so calculateScore can run without DB access
      const fakeJob: Job = {
        id: job.id,
        companyId: "pipeline-dry-run",
        title: result.fields.title ?? job.title,
        url: job.finalUrl,
        location: result.fields.location ?? "",
        workMode: result.fields.workMode ?? "",
        firstPublished: result.fields.dates?.[0] ?? new Date().toISOString(),
        repostedAt: null,
        salaryRange: result.fields.salaryRange ?? "?",
        status: "backlog",
        modifiedAt: null,
        locationFlagged: false,
        jobAlignment: null,
        titleMismatch: false,
        titleMismatchReason: null,
        source: null,
        parser: result.parser,
        originalUrl: null,
      };
      const score = calculateScore(fakeJob, {
        ...emptyCompany,
        name: result.fields.companyName ?? job.companyName,
      });
      return { job, result, score };
    });

  // 8. Save structured logs for ongoing parser tracking
  const logDir = "data/pipeline-logs";
  mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  // Resolution log — one entry per job showing collector URL → resolution outcome
  const resolutionLog = chains.map((chain) => {
    const dbJob = needsResolution.find((j) => j.id === chain.jobId);
    return {
      jobId: chain.jobId,
      startUrl: chain.startUrl,
      hops: chain.hops,
      finalDomain: chain.finalDomain,
      status: chain.status,
      deadEndReason: chain.deadEndReason,
      companyName: dbJob?.company.name,
    };
  });

  // Routing log — domain frequency counts for matched and unmatched jobs
  const routingLog = {
    matched: Object.fromEntries(
      Object.entries(matched).map(([d, jobs]) => [d, jobs.length]),
    ),
    unmatchedCount: unmatched.length,
    unmatchedDomains: Object.entries(
      unmatched.reduce(
        (acc, j) => {
          acc[j.finalDomain] = (acc[j.finalDomain] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([domain, count]) => ({ domain, count })),
  };

  // Parser log — per-job field extraction results and any gaps
  const parserLog = parseResults.map(({ job, result }) => ({
    jobId: job.id,
    url: job.finalUrl,
    finalDomain: job.finalDomain,
    parser: result.parser,
    success: result.success,
    fields: result.fields,
    failedFields: result.failedFields,
    error: result.error,
  }));

  const logData = {
    timestamp: new Date().toISOString(),
    summary: {
      totalJobs: dbJobs.length,
      greenlitShortcut: greenlitJobs.length,
      resolved: statusCounts,
    },
    resolution: resolutionLog,
    routing: routingLog,
    parsing: parserLog,
  };

  writeFileSync(
    `${logDir}/pipeline-${timestamp}.json`,
    JSON.stringify(logData, null, 2),
  );
  console.error(`Logs saved to ${logDir}/pipeline-${timestamp}.json\n`);

  // 9. Print summary + samples to stdout
  printSummary(
    dbJobs.length,
    greenlitJobs.length,
    statusCounts,
    matched,
    unmatched,
    parseResults,
  );
  printSamples(scored);

  process.exit(0);
}

// -- Output helpers --

function printSummary(
  totalJobs: number,
  greenlitCount: number,
  statusCounts: Record<string, number>,
  matched: Record<string, PipelineJob[]>,
  unmatched: PipelineJob[],
  parseResults: Array<{ job: PipelineJob; result: ParserResult }>,
) {
  const pct = (n: number, total: number) =>
    total > 0 ? `(${((n / total) * 100).toFixed(1)}%)` : "";

  console.log("=== Pipeline Summary ===");
  console.log(`Total DB jobs:        ${totalJobs}`);
  console.log(`Greenlit shortcut:    ${greenlitCount}`);

  const resolvedTotal =
    Object.values(statusCounts).reduce((a, b) => a + b, 0) || 0;
  console.log(`\nResolution (${resolvedTotal} jobs):`);
  for (const [status, count] of Object.entries(statusCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(
      `  ${status.padEnd(12)} ${String(count).padStart(4)}  ${pct(count, resolvedTotal)}`,
    );
  }

  console.log("\n=== Routing ===");
  for (const [domain, jobs] of Object.entries(matched)) {
    console.log(`  ${domain.padEnd(30)} ${String(jobs.length).padStart(4)}  → parser`);
  }
  console.log(
    `  ${"(no parser)".padEnd(30)} ${String(unmatched.length).padStart(4)}  → deferred`,
  );

  // Show top 10 unmatched domains to guide future parser work
  if (unmatched.length > 0) {
    const domainCounts: Record<string, number> = {};
    for (const job of unmatched) {
      domainCounts[job.finalDomain] =
        (domainCounts[job.finalDomain] ?? 0) + 1;
    }
    const top = Object.entries(domainCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    console.log("\n  Top unmatched domains:");
    for (const [domain, count] of top) {
      console.log(`    ${domain.padEnd(30)} ${String(count).padStart(4)}`);
    }
  }

  const successCount = parseResults.filter((r) => r.result.success).length;
  const failCount = parseResults.length - successCount;
  console.log("\n=== Parser Results ===");
  console.log(`  Parsed:  ${successCount}/${parseResults.length}`);
  console.log(`  Failed:  ${failCount}/${parseResults.length}`);

  // Which fields were missing most often — guides selector improvements
  const fieldFailCounts: Record<string, number> = {};
  for (const { result } of parseResults) {
    for (const field of result.failedFields) {
      fieldFailCounts[field] = (fieldFailCounts[field] ?? 0) + 1;
    }
  }
  if (Object.keys(fieldFailCounts).length > 0) {
    console.log("  Field gaps:");
    for (const [field, count] of Object.entries(fieldFailCounts).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`    ${field.padEnd(15)} ${count} jobs missing`);
    }
  }
}

function printSamples(
  scored: Array<{
    job: PipelineJob;
    result: ParserResult;
    score: number;
  }>,
) {
  const samples = scored.slice(0, SAMPLE_COUNT);
  if (samples.length === 0) {
    console.log("\n=== No jobs parsed successfully ===");
    return;
  }

  console.log(`\n=== Sample Parsed Jobs (${samples.length}) ===\n`);
  for (let i = 0; i < samples.length; i++) {
    const { job, result, score } = samples[i];
    const f = result.fields;
    console.log(`${i + 1}. Job Title: ${f.title ?? "(not extracted)"}`);
    console.log(`   Company:  ${f.companyName ?? "(not extracted)"}`);
    console.log(`   Salary:   ${f.salaryRange ?? "(not extracted)"}`);
    console.log(
      `   Posted:   ${f.dates?.[0] ?? "(not extracted)"}`,
    );
    console.log(`   Location: ${f.location ?? "(not extracted)"}`);
    console.log(`   Mode:     ${f.workMode ?? "(not extracted)"}`);
    console.log(`   Score:    ${score} (clean-slate company)`);
    console.log(`   Link:     ${job.finalUrl}`);
    console.log();
  }
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
