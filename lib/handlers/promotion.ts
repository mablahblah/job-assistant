// An employer that lists a role again gives it a fresh posting date, which
// pulls the job's age back inside the expiry threshold. The job service is
// the one that notices this — it already filters expired jobs down to the
// ones whose age is back inside the threshold — so this step trusts that
// filtering and promotes every job it is handed, checking no age and no
// status of its own.
//
// This runs late in the pipeline, after collection and dedupe, because an
// expired job only gains a fresh posting date once collection has found the
// new listing and dedupe has merged it into the existing record. Run earlier,
// there would be nothing yet to find.
//
// The job comes back unjudged on purpose: classification should reach its own
// conclusion about the relisted posting rather than inherit the one that
// expired it. Its stored location match, matched place, matched work mode and
// repost mark are left untouched, because classification overwrites them
// moments later anyway — clearing them first would buy nothing.

import type { JobListEntry } from "../types/job-list-entry";
import type { TraceService } from "../services/trace-service";

export interface PromoteJobsOptions {
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface PromoteJobsResult {
  jobs: JobListEntry[];
}

// The entering row and the outcome row, in the order they are written, so a
// heading in the run summary can say what the step was handed even where the
// step later died. Typed as a closed set rather than plain strings, so a word
// this step has no right to write fails to compile. Neither row carries a
// reason: promotion has one outcome, and one population needs nothing to
// group by.
interface PromotionEvent {
  event: "job_entered" | "job_promoted";
}

interface PromotedJob {
  job: JobListEntry;
  events: PromotionEvent[];
}

// A copy, so the job handed in is never touched. Only the fields recording
// where the job sits and what has been judged about it move.
//
// The alignment score goes with them. A promoted job was posted again, so the
// posting it was judged against is not the one now on offer, and the next run
// picks it up because it carries no score.
function promoteJob(job: JobListEntry): PromotedJob {
  return {
    job: {
      ...job,
      status: "backlog",
      is_classified: false,
      alignment_score: null,
      alignment_rationale: null,
    },
    events: [{ event: "job_entered" }, { event: "job_promoted" }],
  };
}

// The step wrapper around promoteJob: calls it once per entry and writes its
// rows through the trace service. It raises no warnings, because a job coming
// back is the step working rather than a problem with it.
export async function promoteJobs(
  jobs: JobListEntry[],
  options: PromoteJobsOptions
): Promise<PromoteJobsResult> {
  const { trace, runId, step } = options;
  const promotedJobs: JobListEntry[] = [];

  for (const job of jobs) {
    const { job: promotedJob, events } = promoteJob(job);
    promotedJobs.push(promotedJob);

    // A trace row is keyed by job id and collector, so a job carrying neither
    // has nothing to key its record on and is promoted without leaving one.
    if (!job.id || !job.collector) continue;

    for (const event of events) {
      // All three of trace, runId and step are needed before a row is
      // written. A step handed only some of them still does its work and
      // stays silent, which is what lets the same function run outside a
      // job search.
      if (trace && runId !== undefined && step !== undefined) {
        await trace.write({
          run_id: runId,
          job_id: job.id,
          step,
          event: event.event,
          collector: job.collector,
        });
      }
    }
  }

  return { jobs: promotedJobs };
}
