// Runs every collector in turn and folds their results into one job list. A
// collector is isolated from its neighbours: a throw, an error string, and a
// warning string all become the same shape, so one source dropping out never
// costs the run the others. This is the one handler taking no job list,
// because it builds the first one.
import type { CollectionIssue } from "../collection-issue";
import { unusableReason } from "../collectors/job-usable";
import type { Collector } from "../collectors/types";
import type { JobListEntry } from "../job-list-entry";
import type { SettingsService } from "../settings-service";
import { messageFromThrown } from "../thrown-message";
import type { TraceService } from "../trace-service";

export interface CollectJobsOptions {
  settings: SettingsService;
  collectors: Collector[];
  // The date stamped into every job's collected_at. It arrives as an argument
  // so collection reads no clock, which is what lets one run share a single
  // stamp and a test pin it to a fixed date.
  collectedAt: Date;
  // Identifies one job search so every trace event it produces can be grouped
  // and compared against other searches. Minted by the caller; collection
  // never generates one itself.
  runId: string;
  // Records each job's path through collection. Never throws: a failed write
  // is swallowed and counted rather than allowed to cancel a run over a row of
  // diagnostics.
  trace: TraceService;
  // How many jobs each collector stops after. Omitted means unlimited.
  limit?: number;
  // Where progress lines go. Defaults to stderr, so a job list printed on
  // stdout stays clean.
  log?: (message: string) => void;
}

export interface CollectJobsResult {
  jobs: JobListEntry[];
  errors: CollectionIssue[];
  warnings: CollectionIssue[];
}

// A dropped job still has to be findable, so it is named by whichever of its
// title or its link survived. `||` rather than `??`, because a blank title is
// one of the reasons a job gets dropped and would otherwise name it "".
function droppedJobWarning(job: JobListEntry, reason: string): string {
  const identity = job.raw_title?.trim() || job.original_url?.trim() || "an unidentified job";
  return `dropped "${identity}": ${reason}`;
}

export async function collectJobs(options: CollectJobsOptions): Promise<CollectJobsResult> {
  // `??` rather than `||`: a limit of 0 is a real value meaning collect
  // nothing, and `0 || Infinity` would read it as no limit at all.
  const limit = options.limit ?? Infinity;
  const log = options.log ?? console.error;

  const result: CollectJobsResult = { jobs: [], errors: [], warnings: [] };

  // Asking for no jobs reaches no source. The collectors are skipped
  // outright rather than run and their results thrown away.
  if (limit <= 0) {
    return result;
  }

  // Sequential and in the given order, so a job list reads the way the run
  // happened and one collector's failure cannot cancel another's work.
  for (const collector of options.collectors) {
    log(`[collect] Running ${collector.name}...`);

    try {
      // A fresh context per collector, so nothing one collector does to it
      // reaches the next.
      const collectorResult = await collector.collect({ settings: options.settings, limit });

      // Kept is counted rather than read off result.jobs, which holds every
      // collector's jobs and not just this one's.
      let kept = 0;
      for (const job of collectorResult.jobs) {
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
          result.warnings.push({
            collector: collector.name,
            message: droppedJobWarning(identified, reason.message),
          });
          continue;
        }

        // Collection is the authority on which collector found a job, so it
        // stamps the name onto a copy rather than trusting the field or
        // editing what the collector handed back. The date this pipeline
        // first saw the job is stamped on the same line, because no later
        // sighting improves on it and no collector can supply it.
        const stamped: JobListEntry = {
          ...identified,
          collector: collector.name,
          collected_at: options.collectedAt,
        };
        result.jobs.push(stamped);
        kept += 1;
      }
      for (const message of collectorResult.errors) {
        result.errors.push({ collector: collector.name, message });
      }
      for (const message of collectorResult.warnings) {
        result.warnings.push({ collector: collector.name, message });
      }

      // Kept rather than found, and the gap named when there is one. A count
      // of what the collector handed over would hide the jobs that did not
      // survive, which is the whole thing this check exists to surface.
      const dropped = collectorResult.jobs.length - kept;
      const droppedNote = dropped > 0 ? ` dropped=${dropped}` : "";
      log(`[collect] ${collector.name}: kept=${kept}${droppedNote}`);
    } catch (thrown) {
      const message = messageFromThrown(thrown);
      result.errors.push({ collector: collector.name, message });
      // Named as a failure rather than a count, because "found=0" reads as a
      // quiet week when what happened is that the collector fell over.
      log(`[collect] ${collector.name} failed: ${message}`);
    }
  }

  return result;
}
