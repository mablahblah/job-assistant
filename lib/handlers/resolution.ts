// Walks every job on the resolution list toward the employer's own posting,
// writes what each walk found back onto its entry, and hands the list on. The
// walk itself is resolveJobUrl; this is the step that runs it over a list,
// several jobs at a time, and records what each one turned out to be.
//
// It is handed a page factory rather than a browser, so it launches nothing of
// its own and a scripted fake stands in for Playwright in its tests.
import type { CollectionIssue } from "../collection-issue";
import type { JobListEntry } from "../job-list-entry";
import type { ResolutionPage, ResolutionPageFactory } from "../resolution-page";
import { resolveJobUrl, type ResolutionOutcome } from "../resolve-job-url";
import type { TraceService } from "../trace-service";

export interface ResolveJobsOptions {
  openPage: ResolutionPageFactory;
  concurrency: number;
  settle?: (page: ResolutionPage) => Promise<void>;
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface ResolveJobsResult {
  jobs: JobListEntry[];
  warnings: CollectionIssue[];
}

// One job after its walk: the entry to return, and the row the walk earned.
// A walk that wrote nothing worth recording carries no event.
interface FollowedEntry {
  job: JobListEntry;
  event?: string;
  reason?: string;
}

// Nothing found, nothing claimed. Dedupe reads a shared resolved URL as proof
// that two jobs are one, so a page the walk only passed through must never be
// written as an answer.
function markUnresolvable(job: JobListEntry): JobListEntry {
  return { ...job, is_resolved: false, resolved_url: null, status: "unresolvable" };
}

function applyOutcome(job: JobListEntry, outcome: ResolutionOutcome): FollowedEntry {
  if (outcome.outcome === "resolved") {
    // A job that resolved keeps whatever status it already had: resolution
    // places a job, it does not move it.
    return {
      job: { ...job, resolved_url: outcome.resolvedUrl, is_resolved: true },
      event: "job_resolved",
      reason: outcome.reason,
    };
  }

  if (outcome.outcome === "failed") {
    return { job: markUnresolvable(job), event: "resolution_failed", reason: outcome.reason };
  }

  // No collector will ever find a hand-entered job again, so dropping it would
  // destroy it for good. It is markUnresolvable instead, and stays repairable.
  if (job.collector === "user") {
    return { job: markUnresolvable(job), event: "resolution_failed", reason: "blacklisted_url" };
  }

  return {
    job: { ...job, delete_on_save: "blacklisted_url", is_resolved: false, resolved_url: null },
    event: "abandoned",
    reason: "blacklisted_url",
  };
}

async function followJobLink(
  job: JobListEntry,
  openPage: ResolutionPageFactory,
  settle?: (page: ResolutionPage) => Promise<void>
): Promise<FollowedEntry> {
  // A walk needs somewhere to start. An entry holding no link is handed back
  // untouched rather than walked from a made-up URL.
  if (!job.original_url) return { job };

  try {
    const lease = await openPage();

    try {
      // Handed no settle of its own, the walk uses its own default.
      const outcome = await resolveJobUrl(job.original_url, lease.page, settle ? { settle } : {});
      return applyOutcome(job, outcome);
    } finally {
      // One site's cookies and consent state must never reach the next job's
      // walk, so the lease closes however the walk ended.
      await lease.close();
    }
  } catch {
    // The browser failed here, not the posting. The entry is returned exactly
    // as it arrived so the next run picks it up again instead of parking a job
    // that may well be fine. The catch sits outside the close above on
    // purpose: a close that throws is this step's problem, not the rest of the
    // list's.
    return { job, event: "resolution_failed", reason: "page_load_failed" };
  }
}

export async function resolveJobs(
  jobs: JobListEntry[],
  options: ResolveJobsOptions
): Promise<ResolveJobsResult> {
  const { openPage, concurrency, settle, trace, runId, step } = options;

  // Seeded with the list as it arrived, so order survives however the walks
  // interleaved and a job whose walk threw is already sitting there untouched.
  const resolvedJobs: JobListEntry[] = jobs.slice();

  // Concurrent, unlike association: every walk is its own page on its own
  // site, waiting on the network and sharing nothing with the others. A headed
  // browser holds the machine for as long as the run lasts, so shortening the
  // run is the whole point. The worker count is the ceiling on how many pages
  // are open at one time.
  let next = 0;

  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const index = next;
      next += 1;

      const job = jobs[index];
      const walked = await followJobLink(job, openPage, settle);
      resolvedJobs[index] = walked.job;

      // A trace row is keyed by job id and collector, so a job carrying
      // neither has nothing to key its record on. All three of trace, runId
      // and step are needed as well: a step handed only some of them still
      // does its work and stays silent, which is what lets the same function
      // run outside a job search.
      if (!walked.event || !job.id || !job.collector) continue;

      if (trace && runId !== undefined && step !== undefined) {
        await trace.write({
          run_id: runId,
          job_id: job.id,
          step,
          event: walked.event,
          collector: job.collector,
          reason: walked.reason,
        });
      }
    }
  }

  // One worker per lane, never more than there are jobs to walk.
  const workerCount = Math.max(1, Math.min(concurrency, jobs.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // This step raises none today. The field is here because every step's
  // result carries it.
  return { jobs: resolvedJobs, warnings: [] };
}
