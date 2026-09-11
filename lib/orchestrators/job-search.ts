// Runs the job search, calling one handler after another and handing each the
// run id, the collection date and the services they share. The collect leg is
// collection, normalization, association, dedupe and save, and it ends in a
// database write, so the run's work outlives the run.
import type { CollectionIssue } from "../collection-issue";
import type { Collector } from "../collectors/types";
import { associateCompanies } from "../handlers/association";
import { collectJobs } from "../handlers/collection";
import type { CompanyService } from "../company-service";
import { dedupeJobs } from "../handlers/dedupe";
import type { JobListEntry } from "../job-list-entry";
import type { JobService } from "../job-service";
import { normalizeJobs } from "../handlers/normalization";
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

  // Read here for the same reason, and read once for the whole run. It ranks
  // the sources a contested field resolves by, and save is handed it rather
  // than opening settings of its own.
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

  // Save writes what survives into rows and deletes what dedupe marked, so a
  // run ends in the database rather than in a list nothing outlives.
  const saved = await saveJobs(report.jobs, {
    jobService: options.jobService,
    priorityList,
    trace: options.trace,
    runId: options.runId,
    step: "post_collection_save",
  });
  report.jobs = saved.jobs;
  report.warnings.push(...saved.warnings);

  // Read once every handler is done, so a write any of them lost is reflected
  // in the total rather than checked write by write.
  report.traceFailures = options.trace.failureCount();

  return report;
}
