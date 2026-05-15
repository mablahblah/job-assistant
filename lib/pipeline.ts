import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { chromium } from "playwright";
import { saveParsedJobs, type PipelineSaveResult, type SaveableJob } from "./pipeline-save";
import { resolveJobUrl } from "./url-resolver";
import {
  isGreenlitDomain,
  routeByDomain,
  getParser,
  registerParser,
} from "./parsers/registry";
import { parseAshbyJob } from "./parsers/ashby";
import { parseGreenhouseJob } from "./parsers/greenhouse";
import { parseLeverJob } from "./parsers/lever";
import { parseAdzunaJob } from "./parsers/adzuna";
import { parseDribbbleJob } from "./parsers/dribbble";
import type { CollectedJob } from "./collectors/types";
import type { PipelineJob, ParserResult } from "./parsers/types";
import type { ResolutionChain } from "./url-resolver";
import { compareFields } from "./parsers/confidence";
import type { ParsedFields } from "./parsers/types";
import { prisma } from "@/lib/prisma";

// Register all available parsers at import time
registerParser("jobs.ashbyhq.com", parseAshbyJob);
registerParser("boards.greenhouse.io", parseGreenhouseJob);
registerParser("jobs.lever.co", parseLeverJob);
registerParser("adzuna.com", parseAdzunaJob);
registerParser("dribbble.com", parseDribbbleJob);

// Max concurrent browser pages during resolution
const CONCURRENCY = 3;

export interface ParseFailure {
  url: string;    // finalUrl sent to the parser
  parser: string; // parser name from result, or domain if parser threw before returning
  error: string;  // error message or "parser returned unsuccessful"
}

export interface PipelineResult {
  collected: number;
  deduped: number;
  resolved: number;
  matched: number;
  unmatched: number;
  parsed: number;
  failures: ParseFailure[];
  save: PipelineSaveResult;
}

export interface PipelineOptions {
  // Skip Playwright browser steps — used in unit tests
  skipPlaywright?: boolean;
}

// Shared pipeline: resolve → route → parse → save.
// In search mode, unmatched jobs (no parser) are dropped.
// In external mode, unmatched jobs are saved with collector data only.
export async function runPipeline(
  jobs: CollectedJob[],
  mode: "search" | "external",
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  console.error(`\n[pipeline] Starting: ${jobs.length} jobs, mode=${mode}\n`);

  // 0. Dedupe — drop collected jobs whose URL is already in the DB
  const knownJobs = await prisma.job.findMany({
    select: { url: true, originalUrl: true },
  });
  const knownUrls = new Set<string>();
  for (const job of knownJobs) {
    knownUrls.add(job.url);
    if (job.originalUrl) knownUrls.add(job.originalUrl);
  }
  const deduped = jobs.filter((j) => knownUrls.has(j.url)).length;
  const newJobs = jobs.filter((j) => !knownUrls.has(j.url));
  console.error(`[pipeline] Dedupe: ${deduped} already in DB, ${newJobs.length} new jobs to process`);

  // 1. Separate greenlit-domain jobs (skip resolution) from those that need it
  const greenlitJobs: PipelineJob[] = [];
  const needsResolution: CollectedJob[] = [];

  for (const job of newJobs) {
    const domain = isGreenlitDomain(job.url);
    if (domain) {
      greenlitJobs.push({
        id: job.url,
        url: job.url,
        title: job.title ?? "",
        companyName: job.companyName ?? "",
        finalUrl: job.url,
        finalDomain: domain,
        source: "greenlit-shortcut",
      });
    } else {
      needsResolution.push(job);
    }
  }
  console.error(`[pipeline] Greenlit shortcut: ${greenlitJobs.length}, needs resolution: ${needsResolution.length}`);

  // 2. Resolve URLs via Playwright (follow redirects to the real job page)
  const resolvedJobs: PipelineJob[] = [];

  if (!options.skipPlaywright && needsResolution.length > 0) {
    const browser = await chromium.launch({ headless: false });
    const resolveQueue = [...needsResolution];
    const chains: ResolutionChain[] = [];

    // Worker pulls from the queue and resolves each job URL
    const resolveWorker = async () => {
      while (resolveQueue.length > 0) {
        const job = resolveQueue.shift()!;
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
          const chain = await resolveJobUrl(job.url, job.url, page);
          chains.push(chain);
          process.stderr.write(`\r  Resolving: ${chains.length}/${needsResolution.length}`);
        } finally {
          await context.close();
        }
      }
    };

    // Run CONCURRENCY workers in parallel
    await Promise.all(Array.from({ length: CONCURRENCY }, () => resolveWorker()));
    process.stderr.write("\n");

    // Convert resolved chains into PipelineJob objects
    for (const chain of chains) {
      if (chain.status !== "resolved") continue;
      const collectedJob = needsResolution.find((j) => j.url === chain.startUrl);
      if (!collectedJob) continue;
      const finalUrl = chain.hops.length > 0
        ? chain.hops[chain.hops.length - 1].url
        : chain.startUrl;

      resolvedJobs.push({
        id: chain.startUrl,
        url: chain.startUrl,
        title: collectedJob.title ?? "",
        companyName: collectedJob.companyName ?? "",
        finalUrl,
        finalDomain: chain.finalDomain,
        source: "resolved",
      });
    }

    await browser.close();
  }

  // 3. Route all jobs to parsers by their final domain
  const allRoutable = [...greenlitJobs, ...resolvedJobs];
  const { matched, unmatched } = routeByDomain(allRoutable);
  const matchedCount = Object.values(matched).reduce((sum, arr) => sum + arr.length, 0);
  console.error(`[pipeline] Routed: ${matchedCount} matched, ${unmatched.length} unmatched`);

  // 4. Parse matched jobs using the registered domain parser
  const parseResults: ParserResult[] = [];
  const failures: ParseFailure[] = [];

  if (!options.skipPlaywright && matchedCount > 0) {
    const browser = await chromium.launch({ headless: false });

    for (const [domain, domainJobs] of Object.entries(matched)) {
      const parser = getParser(domain);
      if (!parser) continue;
      console.error(`[pipeline] Parsing ${domainJobs.length} ${domain} jobs...`);

      for (const job of domainJobs) {
        try {
          // Look up original collector data to pass to parser
          const collectedJob = newJobs.find((j) => j.url === job.url);
          const result = await parser(job.finalUrl, browser, collectedJob);
          // Keep successful results — pass-through parsers return empty fields intentionally
          if (result.success) {
            parseResults.push(result);
          } else {
            // Parser ran but returned unsuccessful — record the failure
            failures.push({
              url: job.finalUrl,
              parser: result.parser,
              error: result.error ?? "parser returned unsuccessful",
            });
          }
        } catch (err) {
          // Parser threw before returning — use domain since there's no result
          failures.push({
            url: job.finalUrl,
            parser: domain,
            error: err instanceof Error ? err.message : String(err),
          });
          console.error(`[pipeline] Parse error for ${job.finalUrl}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    await browser.close();
  }

  console.error(`[pipeline] Parsed: ${parseResults.length} successful`);
  if (failures.length > 0) {
    console.error(`[pipeline] Failures: ${failures.length} parse failures`);
  }

  // 5. Build SaveableJob list from parser results + unmatched (external mode only)
  const saveableJobs: SaveableJob[] = [];

  // Collects URLs dropped by the source gate so we can warn once at the end.
  const adzunaSourceGateWarnings: string[] = [];

  // Jobs that were successfully parsed — use confidence comparison to pick best values
  for (const result of parseResults) {
    const pipelineJob = allRoutable.find((j) => j.finalUrl === result.finalUrl);
    const collectedJob = newJobs.find((j) => j.url === (pipelineJob?.url ?? result.url));

    // Source gate: pass-through parsers only apply to jobs from their own collector.
    // A non-Adzuna job resolving to adzuna.com should not silently save unverified data.
    if (result.parser === "adzuna" && collectedJob?.source !== "adzuna") {
      adzunaSourceGateWarnings.push(collectedJob?.url ?? result.url);
      continue;
    }

    const originalUrl = collectedJob && collectedJob.url !== result.finalUrl ? collectedJob.url : null;

    // Build collector fields in ParsedFields shape for confidence comparison
    const collectorFields: Partial<ParsedFields> | null = collectedJob
      ? {
          title: collectedJob.title || undefined,
          companyName: collectedJob.companyName || undefined,
          location: collectedJob.location || undefined,
          workMode: collectedJob.workMode || undefined,
          postedAt: collectedJob.postedAt?.toISOString().slice(0, 10) || undefined,
          salaryRange: collectedJob.salaryRange || undefined,
        }
      : null;

    // Compare parser output against collector data — parser wins on disagreement
    const confidence = compareFields(result.fields, collectorFields);
    const winning: Record<string, string> = {};
    for (const c of confidence) {
      winning[c.field] = c.value;
    }

    saveableJobs.push({
      url: result.finalUrl,
      title: winning.title ?? result.fields.title ?? collectedJob?.title ?? "",
      companyName: winning.companyName ?? result.fields.companyName ?? collectedJob?.companyName ?? "",
      location: winning.location ?? result.fields.location ?? collectedJob?.location ?? "",
      workMode: winning.workMode ?? result.fields.workMode ?? collectedJob?.workMode ?? "",
      postedAt: winning.postedAt ?? result.fields.postedAt ?? collectedJob?.postedAt?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      salaryRange: winning.salaryRange ?? result.fields.salaryRange ?? collectedJob?.salaryRange ?? "?",
      source: collectedJob?.source ?? "unknown",
      parser: result.parser,
      originalUrl,
    });
  }

  if (adzunaSourceGateWarnings.length > 0) {
    console.error(`[pipeline] WARNING: ${adzunaSourceGateWarnings.length} non-Adzuna jobs resolved to adzuna.com — dropped`);
  }

  // In external mode, save unmatched jobs using only the collector-provided data
  if (mode === "external") {
    for (const pipelineJob of unmatched) {
      const collectedJob = newJobs.find((j) => j.url === pipelineJob.url);

      saveableJobs.push({
        url: pipelineJob.finalUrl,
        title: collectedJob?.title ?? pipelineJob.title ?? "",
        companyName: collectedJob?.companyName ?? pipelineJob.companyName ?? "",
        location: collectedJob?.location ?? "",
        workMode: collectedJob?.workMode ?? "",
        postedAt: collectedJob?.postedAt?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        salaryRange: collectedJob?.salaryRange ?? "?",
        source: collectedJob?.source ?? "external",
        parser: null,
        originalUrl: collectedJob && collectedJob.url !== pipelineJob.finalUrl ? collectedJob.url : null,
      });
    }
  }

  // 6. Persist to database
  const save = await saveParsedJobs(saveableJobs, mode);

  // 7. Write a JSON log of this pipeline run for debugging
  const logDir = "data/pipeline-logs";
  mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logData = {
    timestamp: new Date().toISOString(),
    mode,
    summary: {
      collected: jobs.length,
      deduped,
      greenlitShortcut: greenlitJobs.length,
      resolved: resolvedJobs.length,
      matched: matchedCount,
      unmatched: unmatched.length,
      parsed: parseResults.length,
      failureCount: failures.length,
      save,
    },
    // Domains with unmatched jobs, sorted by frequency — useful for deciding which parsers to add next
    unmatchedDomains: Object.entries(
      unmatched.reduce(
        (acc, j) => { acc[j.finalDomain] = (acc[j.finalDomain] ?? 0) + 1; return acc; },
        {} as Record<string, number>,
      ),
    ).sort((a, b) => b[1] - a[1]).map(([domain, count]) => ({ domain, count })),
    // Parse failures grouped by parser — quick view of which parsers are struggling
    failuresByParser: Object.entries(
      failures.reduce(
        (acc, f) => { acc[f.parser] = (acc[f.parser] ?? 0) + 1; return acc; },
        {} as Record<string, number>,
      ),
    ).sort((a, b) => b[1] - a[1]).map(([parser, count]) => ({ parser, count })),
    // Individual failure details for diagnosis
    failures,
  };
  writeFileSync(`${logDir}/pipeline-${timestamp}.json`, JSON.stringify(logData, null, 2));
  console.error(`[pipeline] Log: ${logDir}/pipeline-${timestamp}.json`);

  return {
    collected: jobs.length,
    deduped,
    resolved: resolvedJobs.length,
    matched: matchedCount,
    unmatched: unmatched.length,
    parsed: parseResults.length,
    failures,
    save,
  };
}
