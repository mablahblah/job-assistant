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
import { dedupeByUrl, dedupeByContent, type ContentDedupeItem, type DbJobForDedupe } from "./dedupe";
import { classifyJobLocations } from "@/lib/geocoding";
import { resolveJobDates } from "@/lib/shared-utils/resolve-job-dates";

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
  dedupe1: { droppedBatchDupes: number; droppedDbMatches: number };
  dedupe2: { droppedBatchDupes: number; droppedDbMatches: number };
  dedupe3: { droppedBatchDupes: number; droppedByDb: number; dbUpdates: number };
  resolved: number;
  matched: number;
  unmatched: number;
  parsed: number;
  failures: ParseFailure[];
  save: PipelineSaveResult;
  unknownGeoClasses: Array<{ className: string; locationString: string; displayName: string }>;
  heldBack: {
    count: number;
    file: string | null;
  };
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

  // 0. Dedupe 1 — post-collection: dedupe by original/collector URL
  const knownOriginalUrls = new Set<string>(
    (await prisma.job.findMany({
      where: { originalUrl: { not: null } },
      select: { originalUrl: true },
    })).map((j) => j.originalUrl!),
  );
  const dedupe1 = dedupeByUrl(jobs, (j) => j.url, knownOriginalUrls);
  const newJobs = dedupe1.kept;
  console.error(`[pipeline] Dedupe 1 (original URLs): ${dedupe1.droppedBatchDupes} batch dupes, ${dedupe1.droppedDbMatches} DB matches, ${newJobs.length} remaining`);

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

  // 2b. Dedupe 2 — post-resolution: dedupe by final/resolved URL
  const allPreRoute = [...greenlitJobs, ...resolvedJobs];
  const knownFinalUrls = new Set<string>(
    (await prisma.job.findMany({
      select: { url: true },
    })).map((j) => j.url),
  );
  const dedupe2 = dedupeByUrl(allPreRoute, (j) => j.finalUrl, knownFinalUrls);
  console.error(`[pipeline] Dedupe 2 (final URLs): ${dedupe2.droppedBatchDupes} batch dupes, ${dedupe2.droppedDbMatches} DB matches, ${dedupe2.kept.length} remaining`);

  // 3. Route all jobs to parsers by their final domain
  const allRoutable = dedupe2.kept;
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

    const originalUrl = collectedJob?.url ?? null;

    // Build collector fields in ParsedFields shape for confidence comparison
    // Dates are excluded — they flow through resolveJobDates, not confidence comparison
    const collectorFields: Partial<ParsedFields> | null = collectedJob
      ? {
          title: collectedJob.title || undefined,
          companyName: collectedJob.companyName || undefined,
          location: collectedJob.location || undefined,
          workMode: collectedJob.workMode || undefined,
          salaryRange: collectedJob.salaryRange || undefined,
        }
      : null;

    // Compare parser output against collector data — parser wins on disagreement
    const confidence = compareFields(result.fields, collectorFields);
    const winning: Record<string, string> = {};
    for (const c of confidence) {
      winning[c.field] = c.value;
    }

    // Pool dates from parser and collector — resolveJobDates handles everything at save time
    const dates: string[] = [
      ...(result.fields.dates ?? []),
      ...(collectedJob?.dates?.map((d) => d.toISOString().slice(0, 10)) ?? []),
    ];

    saveableJobs.push({
      url: result.finalUrl,
      title: winning.title ?? result.fields.title ?? collectedJob?.title ?? "",
      companyName: winning.companyName ?? result.fields.companyName ?? collectedJob?.companyName ?? "",
      location: winning.location ?? result.fields.location ?? collectedJob?.location ?? "",
      workMode: winning.workMode ?? result.fields.workMode ?? collectedJob?.workMode ?? "",
      dates,
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
        dates: collectedJob?.dates?.map((d) => d.toISOString().slice(0, 10)) ?? [],
        salaryRange: collectedJob?.salaryRange ?? "?",
        source: collectedJob?.source ?? "external",
        parser: null,
        originalUrl: collectedJob?.url ?? null,
      });
    }
  }

  // 5b. Dedupe 3 — post-parsing: content-based dedupe by title+company
  const dbJobsForDedupe: DbJobForDedupe[] = await prisma.job.findMany({
    select: {
      id: true,
      title: true,
      status: true,
      parser: true,
      firstPublished: true,
      repostedAt: true,
      location: true,
      workMode: true,
      salaryRange: true,
      company: { select: { name: true } },
    },
  }).then((rows) =>
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      companyName: r.company.name,
      parser: r.parser,
      firstPublished: r.firstPublished.toISOString().slice(0, 10),
      repostedAt: r.repostedAt?.toISOString().slice(0, 10) ?? null,
      status: r.status,
      location: r.location ?? undefined,
      workMode: r.workMode ?? undefined,
      salaryRange: r.salaryRange ?? undefined,
    })),
  );

  const dedupe3 = dedupeByContent(saveableJobs as ContentDedupeItem[], dbJobsForDedupe);
  console.error(`[pipeline] Dedupe 3 (content): ${dedupe3.droppedBatchDupes} batch dupes, ${dedupe3.droppedByDb} DB conflicts, ${dedupe3.dbUpdates.length} DB updates, ${dedupe3.kept.length} new jobs`);

  // Apply DB updates from Dedupe 3 (priority upgrades and reposts)
  for (const update of dedupe3.dbUpdates) {
    // Resolve dates — pool batch dates with existing DB dates via resolveJobDates
    const existingJob = dbJobsForDedupe.find((j) => j.id === update.id);
    const existing = existingJob ? {
      firstPublished: new Date(existingJob.firstPublished),
      repostedAt: existingJob.repostedAt ? new Date(existingJob.repostedAt) : null,
    } : null;
    const newDates = update.dates.map((d) => new Date(d));
    const resolved = resolveJobDates(existing, newDates);

    await prisma.job.update({
      where: { id: update.id },
      data: {
        ...update.data,
        firstPublished: resolved.firstPublished.toISOString(),
        repostedAt: resolved.repostedAt?.toISOString() ?? null,
      },
    });
  }

  // Declare log dir and timestamp here — needed for both held-back file and pipeline log
  const logDir = "data/pipeline-logs";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  // 5c. Geo-based location classification — annotates each job with backlog/too far/skip
  const geoInput = (dedupe3.kept as SaveableJob[]).map((j) => ({
    location: j.location,
    workMode: j.workMode,
  }));
  const { results: geoResults, allUnknownClasses } = await classifyJobLocations(geoInput);

  // Partition: jobs with known classes get saved; jobs with unknown classes are held back
  const classifiedJobs: SaveableJob[] = [];
  const heldBackJobs: SaveableJob[] = [];

  for (let i = 0; i < (dedupe3.kept as SaveableJob[]).length; i++) {
    const job = (dedupe3.kept as SaveableJob[])[i];
    const geoResult = geoResults[i];

    if (geoResult.unknownClasses.length > 0) {
      // Job hit an unknown class — hold back for user review
      heldBackJobs.push(job);
    } else {
      // Job fully classified — annotate and save
      classifiedJobs.push({ ...job, geoStatus: geoResult.status });
    }
  }

  if (allUnknownClasses.length > 0) {
    console.error(`[pipeline] Geo classification: ${allUnknownClasses.length} unknown class(es) encountered`);
    console.error(`[pipeline] Held back ${heldBackJobs.length} job(s) pending class review`);
    for (const uc of allUnknownClasses) {
      console.error(`  - class="${uc.className}" from "${uc.locationString}" (resolved: "${uc.displayName}")`);
    }
  }

  // Write held-back jobs to file so they survive across script invocations
  let heldBackFile: string | null = null;
  if (heldBackJobs.length > 0) {
    heldBackFile = `${logDir}/held-back-${timestamp}.json`;
    mkdirSync(logDir, { recursive: true });
    writeFileSync(heldBackFile, JSON.stringify({ mode, jobs: heldBackJobs }, null, 2));
    console.error(`[pipeline] Held-back jobs written to: ${heldBackFile}`);
  }

  // 6. Persist classified jobs to database (Dedupe 3 already handled updates)
  const save = await saveParsedJobs(classifiedJobs, mode);

  // 7. Write a JSON log of this pipeline run for debugging
  mkdirSync(logDir, { recursive: true });
  const logData = {
    timestamp: new Date().toISOString(),
    mode,
    summary: {
      collected: jobs.length,
      dedupe1: { droppedBatchDupes: dedupe1.droppedBatchDupes, droppedDbMatches: dedupe1.droppedDbMatches },
      dedupe2: { droppedBatchDupes: dedupe2.droppedBatchDupes, droppedDbMatches: dedupe2.droppedDbMatches },
      dedupe3: { droppedBatchDupes: dedupe3.droppedBatchDupes, droppedByDb: dedupe3.droppedByDb, dbUpdates: dedupe3.dbUpdates.length },
      greenlitShortcut: greenlitJobs.length,
      resolved: resolvedJobs.length,
      matched: matchedCount,
      unmatched: unmatched.length,
      parsed: parseResults.length,
      failureCount: failures.length,
      save,
      unknownGeoClasses: allUnknownClasses.length,
      heldBack: heldBackJobs.length,
      heldBackFile,
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
    dedupe1: { droppedBatchDupes: dedupe1.droppedBatchDupes, droppedDbMatches: dedupe1.droppedDbMatches },
    dedupe2: { droppedBatchDupes: dedupe2.droppedBatchDupes, droppedDbMatches: dedupe2.droppedDbMatches },
    dedupe3: { droppedBatchDupes: dedupe3.droppedBatchDupes, droppedByDb: dedupe3.droppedByDb, dbUpdates: dedupe3.dbUpdates.length },
    resolved: resolvedJobs.length,
    matched: matchedCount,
    unmatched: unmatched.length,
    parsed: parseResults.length,
    failures,
    save,
    unknownGeoClasses: allUnknownClasses,
    heldBack: {
      count: heldBackJobs.length,
      file: heldBackFile,
    },
  };
}
