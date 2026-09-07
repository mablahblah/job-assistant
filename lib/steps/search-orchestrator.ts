// Runs every collector in turn and folds their results into one report, then
// normalizes what survives in a single pass over the whole list. A collector
// is isolated from its neighbours: a throw, an error string, and a warning
// string all become the same shape, so one source dropping out never costs
// the run the others.
import type { CollectionIssue } from "../collection-issue";
import { unusableReason } from "../collectors/job-usable";
import type { Collector } from "../collectors/types";
import { associateCompanies } from "./association";
import type { CompanyService } from "../company-service";
import type { JobListEntry } from "../job-list-entry";
import { normalizeJobs } from "./normalization";
import type { SettingsService } from "../settings-service";
import { messageFromThrown } from "../thrown-message";
import type { TitleVocabularies } from "../title";
import type { TraceWriter } from "../trace-writer";

export interface CollectionReport {
  jobs: JobListEntry[];
  errors: CollectionIssue[];
  warnings: CollectionIssue[];
  // How many trace writes this run lost. Always present, 0 when nothing
  // failed, so a caller never has to check whether the field exists before
  // reading it.
  traceFailures: number;
}

export interface CollectionOptions {
  settings: SettingsService;
  collectors: Collector[];
  // Required, not optional: association is what gives a job the company
  // identity dedupe later matches on, so a caller can't forget it and have
  // the orchestrator silently skip it.
  companies: CompanyService;
  // Identifies one job search so every trace event it produces can be
  // grouped and compared against other searches. Minted by the caller;
  // the orchestrator never generates one itself.
  runId: string;
  // Records each job's path through collection. Never throws: a failed write
  // is swallowed and counted rather than allowed to cancel a run over a row
  // of diagnostics.
  trace: TraceWriter;
  // How many jobs each collector stops after. Omitted means unlimited.
  limit?: number;
  // Where progress lines go. Defaults to stderr, so a job list printed on
  // stdout stays clean.
  log?: (message: string) => void;
}

// A dropped job still has to be findable, so it is named by whichever of its
// title or its link survived. `||` rather than `??`, because a blank title is
// one of the reasons a job gets dropped and would otherwise name it "".
function droppedJobWarning(job: JobListEntry, reason: string): string {
  const identity = job.raw_title?.trim() || job.original_url?.trim() || "an unidentified job";
  return `dropped "${identity}": ${reason}`;
}

export async function runCollection(options: CollectionOptions): Promise<CollectionReport> {
  // `??` rather than `||`: a limit of 0 is a real value meaning collect
  // nothing, and `0 || Infinity` would read it as no limit at all.
  const limit = options.limit ?? Infinity;
  const log = options.log ?? console.error;

  const report: CollectionReport = { jobs: [], errors: [], warnings: [], traceFailures: 0 };

  // Asking for no jobs reaches no source. The collectors are skipped
  // outright rather than run and their results thrown away.
  if (limit <= 0) {
    return report;
  }

  // Read outside every try, deliberately: a missing title vocabulary means
  // the settings service throws, and that has to stop the whole run rather
  // than read as one collector failing.
  const vocabularies: TitleVocabularies = {
    headNouns: await options.settings.getTitleHeadNouns(),
    levels: await options.settings.getTitleLevels(),
    suffixes: await options.settings.getTitleSuffixes(),
    removalWords: await options.settings.getTitleRemovalWords(),
  };

  // Sequential and in the given order, so a job list reads the way the run
  // happened and one collector's failure cannot cancel another's work.
  for (const collector of options.collectors) {
    log(`[collect] Running ${collector.name}...`);

    try {
      // A fresh context per collector, so nothing one collector does to it
      // reaches the next.
      const result = await collector.collect({ settings: options.settings, limit });

      // Kept is counted rather than read off report.jobs, which holds every
      // collector's jobs and not just this one's.
      let kept = 0;
      for (const job of result.jobs) {
        // An id is assigned the instant a job enters the loop, on its own,
        // because a job dropped by the usability check still needs one to
        // name it in a dead-end trace event later.
        const id = crypto.randomUUID();
        const identified: JobListEntry = { ...job, id };

        // Every job that reaches the loop gets a record of it, whether or not
        // it survives the usability check below.
        await options.trace.write({
          run_id: options.runId,
          job_id: id,
          step: "collection",
          event: "collected",
          collector: collector.name,
        });

        // A job that cannot travel is dropped here rather than allowed to
        // fail somewhere later, where what went wrong is harder to read.
        const reason = unusableReason(identified);
        if (reason !== null) {
          await options.trace.write({
            run_id: options.runId,
            job_id: id,
            step: "collection",
            event: "abandoned",
            collector: collector.name,
            reason: reason.code,
            detail: reason.detail,
          });
          report.warnings.push({
            collector: collector.name,
            message: droppedJobWarning(identified, reason.message),
          });
          continue;
        }

        // The orchestrator is the authority on which collector found a job,
        // so it stamps the name onto a copy rather than trusting the field
        // or editing what the collector handed back.
        const stamped: JobListEntry = { ...identified, collector: collector.name };
        report.jobs.push(stamped);
        kept += 1;
      }
      for (const message of result.errors) {
        report.errors.push({ collector: collector.name, message });
      }
      for (const message of result.warnings) {
        report.warnings.push({ collector: collector.name, message });
      }

      // Kept rather than found, and the gap named when there is one. A count
      // of what the collector handed over would hide the jobs that did not
      // survive, which is the whole thing this check exists to surface.
      const dropped = result.jobs.length - kept;
      const droppedNote = dropped > 0 ? ` dropped=${dropped}` : "";
      log(`[collect] ${collector.name}: kept=${kept}${droppedNote}`);
    } catch (thrown) {
      const message = messageFromThrown(thrown);
      report.errors.push({ collector: collector.name, message });
      // Named as a failure rather than a count, because "found=0" reads as a
      // quiet week when what happened is that the collector fell over.
      log(`[collect] ${collector.name} failed: ${message}`);
    }
  }

  // One call with every collector's surviving jobs, which is what a pipeline
  // step is handed. It writes its own trace rows and hands back the warnings
  // it raised, folded to one line per collector rather than one per job.
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

  // Read once normalization and association are both done, so a write any
  // step lost is reflected in the total rather than checked write by write.
  report.traceFailures = options.trace.failureCount();

  return report;
}
