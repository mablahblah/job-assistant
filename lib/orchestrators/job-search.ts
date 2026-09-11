// Runs the job search, calling one handler after another and handing each the
// run id, the collection date and the services they share. Two legs run in
// sequence, and each ends in a database write, so a run's work outlives the
// run whether or not the next leg gets to it. The collect leg is collection,
// normalization, association, dedupe and save. The resolution leg then reads
// its own list of jobs still needing a source URL — nothing upstream hands it
// work, because the database is the only handoff between legs — walks them
// behind one shared browser, then dedupes and saves what came back.
import type { CollectionIssue } from "../collection-issue";
import type { Collector } from "../collectors/types";
import { associateCompanies } from "../handlers/association";
import { collectJobs } from "../handlers/collection";
import type { CompanyService } from "../company-service";
import { dedupeJobs } from "../handlers/dedupe";
import type { JobListEntry } from "../job-list-entry";
import type { JobService } from "../job-service";
import { normalizeJobs } from "../handlers/normalization";
import { resolveJobs } from "../handlers/resolution";
import type { ResolutionBrowserFactory, ResolutionPage } from "../resolution-page";
import { saveJobs } from "../handlers/save";
import type { SettingsService } from "../settings-service";
import type { TitleVocabularies } from "../title";
import type { TraceService } from "../trace-service";

export interface RunJobSearchResult {
  jobs: JobListEntry[];
  errors: CollectionIssue[];
  warnings: CollectionIssue[];
  // How many trace writes this run lost. Always present, 0 when nothing
  // failed, so a caller never has to check whether the field exists before
  // reading it.
  traceFailures: number;
}

export interface RunJobSearchOptions {
  settings: SettingsService;
  collectors: Collector[];
  // Required, not optional: association is what gives a job the company
  // identity dedupe later matches on, so a caller can't forget it and have
  // the orchestrator silently skip it.
  companies: CompanyService;
  // Required, not optional, for the same reason: a caller that omitted it
  // would have the run end without writing a row, which is what a run that
  // found nothing also looks like.
  jobService: JobService;
  // Required, not optional, for the same reason again: a caller that omitted
  // it would have the resolution leg silently skip, which reads the same as a
  // run that had nothing left to resolve.
  openBrowser: ResolutionBrowserFactory;
  // The seam that lets the resolution leg be tested offline against scripted
  // pages. Left out, the walk settles a page the way it does in a browser.
  settle?: (page: ResolutionPage) => Promise<void>;
  // The date stamped into every job's collected_at. It arrives as an
  // argument so the orchestrator reads no clock, which is what lets one run
  // share a single stamp and a test pin it to a fixed date.
  collectedAt: Date;
  // Identifies one job search so every trace event it produces can be
  // grouped and compared against other searches. Minted by the caller;
  // the orchestrator never generates one itself.
  runId: string;
  // Records each job's path through collection. Never throws: a failed write
  // is swallowed and counted rather than allowed to cancel a run over a row
  // of diagnostics.
  trace: TraceService;
  // How many jobs each collector stops after. Omitted means unlimited.
  limit?: number;
  // Where progress lines go. Defaults to stderr, so a job list printed on
  // stdout stays clean.
  log?: (message: string) => void;
}

export async function runJobSearch(options: RunJobSearchOptions): Promise<RunJobSearchResult> {
  // The collection handler owns the collectors, the job ids and the usability
  // check, and hands back the first job list of the run.
  const collected = await collectJobs({
    settings: options.settings,
    collectors: options.collectors,
    collectedAt: options.collectedAt,
    runId: options.runId,
    trace: options.trace,
    limit: options.limit,
    log: options.log,
  });

  const report: RunJobSearchResult = {
    jobs: collected.jobs,
    errors: collected.errors,
    warnings: collected.warnings,
    traceFailures: 0,
  };

  // Read before the handlers run, deliberately: a missing title vocabulary
  // means the settings service throws, and that has to stop the whole run
  // rather than read as one handler failing.
  const vocabularies: TitleVocabularies = {
    headNouns: await options.settings.getTitleHeadNouns(),
    levels: await options.settings.getTitleLevels(),
    suffixes: await options.settings.getTitleSuffixes(),
    removalWords: await options.settings.getTitleRemovalWords(),
  };

  // Read here for the same reason, and read once for the whole run: both legs
  // hand it to their dedupe and save calls, so merging the legs removes the
  // resolution leg's own second read of the same list.
  const priorityList = await options.settings.getSourcePriorityList();

  // One call with every collector's surviving jobs, which is what a handler
  // is handed. It writes its own trace rows and hands back the warnings it
  // raised, folded to one line per collector rather than one per job.
  const normalized = await normalizeJobs(report.jobs, {
    vocabularies,
    trace: options.trace,
    runId: options.runId,
    step: "post_collection_normalization",
  });
  report.jobs = normalized.jobs;
  report.warnings.push(...normalized.warnings);

  // Association gives each surviving job the company identity dedupe later
  // matches on, so it runs over the same list normalization produced.
  const associated = await associateCompanies(report.jobs, {
    companies: options.companies,
    trace: options.trace,
    runId: options.runId,
    step: "post_collection_association",
  });
  report.jobs = associated.jobs;
  report.warnings.push(...associated.warnings);

  // Dedupe reduces the list to one entry per real posting, matching on the
  // company identity association just attached to each job.
  const deduped = await dedupeJobs(report.jobs, {
    jobService: options.jobService,
    priorityList,
    collectedAt: options.collectedAt,
    trace: options.trace,
    runId: options.runId,
    step: "post_collection_dedupe",
  });
  report.jobs = deduped.jobs;
  report.warnings.push(...deduped.warnings);

  // Save writes what survives into rows and deletes what dedupe marked, so
  // the collect leg ends in the database rather than in a list nothing
  // outlives.
  const saved = await saveJobs(report.jobs, {
    jobService: options.jobService,
    priorityList,
    trace: options.trace,
    runId: options.runId,
    step: "post_collection_save",
  });
  report.jobs = saved.jobs;
  report.warnings.push(...saved.warnings);

  // The resolution leg takes no job list from the collect leg — it queries
  // the database for whatever still needs a source URL, which is what lets
  // this leg run over jobs collected by any earlier run as well.
  const unresolved = await options.jobService.findUnresolved();

  // A headed browser holds the machine for as long as it runs, so a list with
  // nothing to walk must never reach the point of launching one.
  if (unresolved.length > 0) {
    // Read before the browser is launched, deliberately: a missing setting
    // throws, and throwing here costs no browser rather than opening one for
    // a run that cannot go ahead.
    const concurrency = await options.settings.getResolutionConcurrency();

    const browser = await options.openBrowser();

    try {
      const resolved = await resolveJobs(unresolved, {
        openPage: browser.openPage,
        concurrency,
        settle: options.settle,
        trace: options.trace,
        runId: options.runId,
        step: "resolution",
      });
      report.warnings.push(...resolved.warnings);

      // Dedupe reduces the list to one entry per real posting, now that
      // resolution has given every job the source URL identity is judged on.
      const resolvedDeduped = await dedupeJobs(resolved.jobs, {
        jobService: options.jobService,
        priorityList,
        collectedAt: options.collectedAt,
        trace: options.trace,
        runId: options.runId,
        step: "post_resolution_dedupe",
      });
      report.warnings.push(...resolvedDeduped.warnings);

      // Save writes what survives and deletes what dedupe marked, so the
      // resolution leg also ends in the database rather than in a list
      // nothing outlives.
      const resolvedSaved = await saveJobs(resolvedDeduped.jobs, {
        jobService: options.jobService,
        priorityList,
        trace: options.trace,
        runId: options.runId,
        step: "post_resolution_save",
      });
      report.warnings.push(...resolvedSaved.warnings);

      // The report lists every job the run acted on, so the two legs' saved
      // lists are joined on id. The resolution leg's version wins, because it
      // ran later and its fields are newer. A job carrying no id is appended
      // rather than matched: save itself treats a missing id as possible, and
      // two jobs without one are two jobs rather than one seen twice.
      for (const job of resolvedSaved.jobs) {
        const existing = job.id
          ? report.jobs.findIndex((entry) => entry.id === job.id)
          : -1;
        if (existing === -1) {
          report.jobs.push(job);
        } else {
          report.jobs[existing] = job;
        }
      }
    } finally {
      // A throw from any handler must still close the browser it opened.
      await browser.close();
    }
  }

  // Read once both legs are done, so a write either one lost is reflected in
  // the total rather than checked leg by leg.
  report.traceFailures = options.trace.failureCount();

  return report;
}
