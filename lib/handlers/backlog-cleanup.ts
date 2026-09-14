// Sweeps the backlog before a run collects anything, marking every job that
// has aged past the expiry threshold as expired and leaving the rest exactly
// as they were. It opens the run so that the backlog being added to has
// already been swept.
//
// The threshold and the instant to measure against both arrive as arguments
// rather than being read from settings or the clock. A run can spend half an
// hour in a browser between its first age check and its last, and every job
// in one run is judged against the moment the run started, so a job sitting
// exactly on the line waits for the next run rather than being judged twice
// by two clocks.
//
// Age is measured by jobAgeInDays, which already decides which of a job's
// dates is the one to count from. This step only asks whether that age has
// crossed the line, and what to write down about the answer.

import { isPastThreshold, jobAgeInDays } from "../utils/job-age";
import type { JobListEntry } from "../types/job-list-entry";
import type { TraceService } from "../services/trace-service";

export interface CleanBacklogJobsOptions {
  expiryThresholdDays: number;
  referenceInstant: Date;
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface CleanBacklogJobsResult {
  jobs: JobListEntry[];
}

// The entering row and the outcome row, in the order they are written, so a
// heading in the run summary can say what the step was handed even where the
// step later died. Typed as a closed set rather than plain strings, so a word
// this step has no right to write fails to compile.
interface BacklogCleanupEvent {
  event: "job_entered" | "job_kept" | "job_expired";
  reason?: "past_expiry_threshold";
}

interface CleanedBacklogJob {
  job: JobListEntry;
  events: BacklogCleanupEvent[];
}

// Judges one job. JobListEntry types every field as optional because it is a
// partial of the database row, but collected_at is a required column, so a
// job read back off the backlog always carries one. The fallback exists to
// satisfy the type rather than to cover a real case, and it reads an undated
// job as collected this instant, which keeps it in the backlog — missing data
// is never on its own a reason to expire a job.
function cleanBacklogJob(
  job: JobListEntry,
  expiryThresholdDays: number,
  referenceInstant: Date
): CleanedBacklogJob {
  const ageInDays = jobAgeInDays(
    {
      posting_date: job.posting_date,
      posting_updated_date: job.posting_updated_date,
      collected_at: job.collected_at ?? referenceInstant,
    },
    referenceInstant
  );

  if (isPastThreshold(ageInDays, expiryThresholdDays)) {
    // A copy, so the job handed in is never touched. Only the status moves:
    // nothing else about an expired job has changed.
    return {
      job: { ...job, status: "expired" },
      events: [{ event: "job_entered" }, { event: "job_expired", reason: "past_expiry_threshold" }],
    };
  }

  return {
    job,
    events: [{ event: "job_entered" }, { event: "job_kept" }],
  };
}

// The step wrapper around cleanBacklogJob: calls it once per entry and writes
// its rows through the trace service. It raises no warnings, because nothing
// here is something the user has to be told about — a job ageing out is the
// step working, not a problem with it.
export async function cleanBacklogJobs(
  jobs: JobListEntry[],
  options: CleanBacklogJobsOptions
): Promise<CleanBacklogJobsResult> {
  const { expiryThresholdDays, referenceInstant, trace, runId, step } = options;
  const cleanedJobs: JobListEntry[] = [];

  for (const job of jobs) {
    const { job: cleanedJob, events } = cleanBacklogJob(job, expiryThresholdDays, referenceInstant);
    cleanedJobs.push(cleanedJob);

    // A trace row is keyed by job id and collector, so a job carrying neither
    // has nothing to key its record on and is judged without leaving a record.
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
          reason: event.reason,
        });
      }
    }
  }

  return { jobs: cleanedJobs };
}
