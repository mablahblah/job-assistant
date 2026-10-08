// Jobs a user adds by hand go through the same pipeline steps a job search
// uses, but those steps often can't learn enough about a hand-added job to
// judge it (no listing page to resolve, no location text to check). Rather
// than leaving such a job stuck unjudged, this handler lets it through to
// scoring and records why, at each of the two positions that can get stuck.

import type { JobListEntry } from "../types/job-list-entry";
import type { TraceService } from "../services/trace-service";

export interface LetJobsThroughOptions {
  after: "parsing" | "classification";
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface LetJobsThroughResult {
  jobs: JobListEntry[];
}

const EVENT_NAME = "job_let_through";

// The reason a job was let through, as a closed set rather than a plain
// string, so a word this step has no right to write fails to compile.
type LetThroughReason = "no_location" | "location_unusable";

interface LetThroughOutcome {
  job: JobListEntry;
  reason?: LetThroughReason;
}

// A copy, so the job handed in is never touched. Returns it unchanged,
// with no reason, when this position has nothing to let through.
function letJobThrough(
  job: JobListEntry,
  after: LetJobsThroughOptions["after"]
): LetThroughOutcome {
  if (after === "parsing") {
    // Page reading found no real place for this job: there is nothing left
    // for later steps to check, so it goes straight back to the backlog
    // marked done at every step scoring expects to have run.
    if (job.status === "unparseable") {
      return {
        job: { ...job, status: "backlog", is_resolved: true, is_parsed: true, is_classified: true },
        reason: "no_location",
      };
    }
    return { job: { ...job } };
  }

  // after === "classification". A job still in the backlog (status left off
  // counts as backlog) that the location check never marked is one the map
  // could not find a place for — it stays in the backlog but is marked
  // checked so it is not picked up here again.
  const stillInBacklog = job.status === "backlog" || job.status === undefined;
  if (stillInBacklog && job.is_classified !== true) {
    return {
      job: { ...job, is_classified: true },
      reason: "location_unusable",
    };
  }
  return { job: { ...job } };
}

// The step wrapper around letJobThrough: calls it once per entry and writes
// a trace row for each job actually let through. It raises no warnings and
// serves both pipeline positions through the same `after` switch.
export async function letJobsThrough(
  jobs: JobListEntry[],
  options: LetJobsThroughOptions
): Promise<LetJobsThroughResult> {
  const { after, trace, runId, step } = options;
  const letJobs: JobListEntry[] = [];

  for (const job of jobs) {
    const { job: resultJob, reason } = letJobThrough(job, after);
    letJobs.push(resultJob);

    // No reason means this job was left as it was — nothing to record.
    if (!reason) continue;

    // A trace row is keyed by job id and collector, so a job carrying
    // neither has nothing to key its record on and is let through silently.
    if (!job.id || !job.collector) continue;

    // All three of trace, runId and step are needed before a row is
    // written. A step handed only some of them still does its work and
    // stays silent, which is what lets the same function run outside a
    // job search.
    if (trace && runId !== undefined && step !== undefined) {
      await trace.write({
        run_id: runId,
        job_id: job.id,
        step,
        event: EVENT_NAME,
        reason,
        collector: job.collector,
      });
    }
  }

  return { jobs: letJobs };
}
