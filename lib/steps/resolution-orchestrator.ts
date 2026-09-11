// Runs the URL-resolution leg end to end: it reads its own list of jobs still
// needing a source URL, walks them behind one shared browser, then dedupes and
// saves what came back. It takes no job list because nothing upstream hands it
// work — the database is the only handoff between legs, so each one queries
// what it has to do and writes back what it did.
import type { CollectionIssue } from "../collection-issue";
import { dedupeJobs } from "./dedupe";
import type { JobListEntry } from "../job-list-entry";
import type { JobService } from "../job-service";
import type { ResolutionBrowserFactory, ResolutionPage } from "../resolution-page";
import { resolveJobs } from "./resolution";
import { saveJobs } from "./save";
import type { SettingsService } from "../settings-service";
import type { TraceService } from "../trace-service";

export interface ResolutionOptions {
  jobService: JobService;
  settings: SettingsService;
  openBrowser: ResolutionBrowserFactory;
  // Dedupe's fallback collection date. Every job on this list came out of a
  // row and carries its own, so it never fires — but it arrives as an
  // argument all the same, so this reads no clock and a test can pin it.
  collectedAt: Date;
  runId: string;
  trace: TraceService;
  // The seam that lets the whole leg be tested offline against scripted
  // pages. Left out, the walk settles a page the way it does in a browser.
  settle?: (page: ResolutionPage) => Promise<void>;
}

export interface ResolutionReport {
  jobs: JobListEntry[];
  warnings: CollectionIssue[];
  // How many trace writes this run lost. Always present, 0 when nothing
  // failed, so a caller never has to check whether the field exists.
  traceFailures: number;
}

export async function runResolution(options: ResolutionOptions): Promise<ResolutionReport> {
  const jobs = await options.jobService.findUnresolved();

  // A headed browser holds the machine for as long as it runs, so a list with
  // nothing to walk must never reach the point of launching one.
  if (jobs.length === 0) {
    return { jobs, warnings: [], traceFailures: options.trace.failureCount() };
  }

  // Read before the browser is launched, deliberately: a missing setting
  // throws, and throwing here costs no browser rather than opening one for a
  // run that cannot go ahead.
  const priorityList = await options.settings.getSourcePriorityList();
  const concurrency = await options.settings.getResolutionConcurrency();

  const warnings: CollectionIssue[] = [];
  const browser = await options.openBrowser();

  try {
    const resolved = await resolveJobs(jobs, {
      openPage: browser.openPage,
      concurrency,
      settle: options.settle,
      trace: options.trace,
      runId: options.runId,
      step: "resolution",
    });
    warnings.push(...resolved.warnings);

    // Dedupe reduces the list to one entry per real posting, now that
    // resolution has given every job the source URL identity is judged on.
    const deduped = await dedupeJobs(resolved.jobs, {
      jobService: options.jobService,
      priorityList,
      collectedAt: options.collectedAt,
      trace: options.trace,
      runId: options.runId,
      step: "post_resolution_dedupe",
    });
    warnings.push(...deduped.warnings);

    // Save writes what survives and deletes what dedupe marked, so the leg
    // ends in the database rather than in a list nothing outlives.
    const saved = await saveJobs(deduped.jobs, {
      jobService: options.jobService,
      priorityList,
      trace: options.trace,
      runId: options.runId,
      step: "post_resolution_save",
    });
    warnings.push(...saved.warnings);

    return {
      jobs: saved.jobs,
      warnings,
      // Read once every step is done, so a write any of them lost is
      // reflected in the total rather than checked write by write.
      traceFailures: options.trace.failureCount(),
    };
  } finally {
    // A throw from any step must still close the browser it opened.
    await browser.close();
  }
}
