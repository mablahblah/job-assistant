// Resolves every job on the resolution list toward the employer's own posting,
// writes what each job's resolution found back onto its entry, and hands the list on. The
// resolution itself is resolveJobUrl; this is the step that runs it over a list,
// several jobs at a time, and records what each one turned out to be.
//
// It is handed a page factory rather than a browser, so it launches nothing of
// its own and a scripted fake stands in for Playwright in its tests.
import type { CollectionIssue } from "../collection-issue";
import type { JobListEntry } from "../job-list-entry";
import type { ResolutionPage, ResolutionPageFactory } from "../resolution-page";
import { interleaveByHost } from "../interleave-by-host";
import { resolveJobUrl, type ResolutionOutcome } from "../resolve-job-url";
import type { TraceService } from "../trace-service";

export interface ResolveJobsOptions {
  openPage: ResolutionPageFactory;
  fastConcurrency: number;
  // Optional because a run where nothing refuses us never reaches the slow
  // lane, so a caller with no reason to think about it need not name either.
  slowConcurrency?: number;
  slowPauseMs?: number;
  waitForLoad?: (page: ResolutionPage) => Promise<void>;
  // Injected so a test can watch the pauses rather than sit through them.
  wait?: (ms: number) => Promise<void>;
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface ResolveJobsResult {
  jobs: JobListEntry[];
  warnings: CollectionIssue[];
}

// One job after its resolution: the entry to return, and the row resolution earned.
// A job's resolution that wrote nothing worth recording carries no event.
interface FollowedEntry {
  job: JobListEntry;
  event?: string;
  reason?: string;
}

// Nothing found, nothing claimed. Dedupe reads a shared resolved URL as proof
// that two jobs are one, so a page resolution only passed through must never be
// written as an answer.
function markUnresolvable(job: JobListEntry): JobListEntry {
  return { ...job, is_resolved: false, resolved_url: null, status: "unresolvable" };
}

// The two failures that describe the moment rather than the job. A source
// that refused us and a page the browser could not load both say nothing
// about whether the posting is any good, and both may answer next time.
// Parking a job for one of these loses a real job to someone else's bad
// afternoon, and it never comes back, because the list of jobs to resolve
// only ever reads jobs still in the backlog.
const RETRYABLE_FAILURES = ["page_refused", "page_load_failed"] as const;

function isRetryable(reason: string): boolean {
  return (RETRYABLE_FAILURES as readonly string[]).includes(reason);
}

// Keeps the job exactly where it was. Status is left untouched rather than
// set, so a job arrives at the next run in the same state it arrived at this
// one, and the resolved URL stays empty because nothing was found.
function leaveForNextRun(job: JobListEntry): JobListEntry {
  return { ...job, is_resolved: false, resolved_url: null };
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
    const job_ = isRetryable(outcome.reason) ? leaveForNextRun(job) : markUnresolvable(job);
    return { job: job_, event: "resolution_failed", reason: outcome.reason };
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
  waitForLoad?: (page: ResolutionPage) => Promise<void>
): Promise<FollowedEntry> {
  // A job's resolution needs somewhere to start. An entry holding no link is handed back
  // untouched rather than resolved from a made-up URL.
  if (!job.original_url) return { job };

  try {
    const opened = await openPage();

    try {
      // Handed no waitForLoad of its own, resolution uses its own default.
      const outcome = await resolveJobUrl(job.original_url, opened.page, waitForLoad ? { waitForLoad } : {});
      return applyOutcome(job, outcome);
    } finally {
      // One site's cookies and consent state must never reach the next job's
      // resolution, so the open page closes however resolution ended.
      await opened.close();
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
  const {
    openPage,
    fastConcurrency,
    slowConcurrency = 1,
    slowPauseMs = 12_000,
    waitForLoad,
    wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    trace,
    runId,
    step,
  } = options;

  // Seeded with the list as it arrived, so the result comes back in the order
  // the caller handed it over however the two lanes interleaved, and a job
  // whose resolution threw is already sitting there untouched.
  const resolvedJobs: JobListEntry[] = jobs.slice();

  // Both lanes work reordered views of the same entries, so this is the only
  // way back from a job to the position its result belongs at.
  const positionOf = new Map<JobListEntry, number>();
  jobs.forEach((job, index) => positionOf.set(job, index));

  // The same derivation interleaveByHost uses. A job whose link is missing or
  // unreadable belongs to no host, so it can neither be held back by a
  // refused one nor send one to the slow lane itself.
  function hostOf(job: JobListEntry): string | undefined {
    if (!job.original_url) return undefined;
    try {
      return new URL(job.original_url).host;
    } catch {
      return undefined;
    }
  }

  function record(job: JobListEntry, followed: FollowedEntry): void {
    const position = positionOf.get(job);
    if (position !== undefined) resolvedJobs[position] = followed.job;
  }

  async function writeTrace(job: JobListEntry, followed: FollowedEntry): Promise<void> {
    // A trace row is keyed by job id and collector, so a job carrying
    // neither has nothing to key its record on. All three of trace, runId
    // and step are needed as well: a step handed only some of them still
    // does its work and stays silent, which is what lets the same function
    // run outside a job search.
    if (!followed.event || !job.id || !job.collector) return;
    if (!trace || runId === undefined || step === undefined) return;

    await trace.write({
      run_id: runId,
      job_id: job.id,
      step,
      event: followed.event,
      collector: job.collector,
      reason: followed.reason,
    });
  }

  // Jobs from one site arriving back to back is what gets a host to refuse us
  // in the first place, so the fast lane never sees the caller's order. It
  // sees one job from each host in turn.
  const dealt = interleaveByHost(jobs);

  // Empty at the start of every call. Which hosts end up here is decided
  // entirely by what they did during this run — nothing names one, and
  // nothing carries over from the run before.
  const refusedHosts = new Set<string>();

  // What the fast lane declined to finish: a job whose host had already
  // refused us, and the job whose own attempt proved that. Neither keeps a
  // result or a trace row, because the slow lane's attempt is the one that
  // counts.
  const slowLaneJobs: JobListEntry[] = [];

  let nextFast = 0;

  async function fastWorker(): Promise<void> {
    while (nextFast < dealt.length) {
      const index = nextFast;
      nextFast += 1;

      const job = dealt[index];
      if (!job) continue;
      const host = hostOf(job);

      // Asking again would spend a visit learning what the last one already
      // proved, and every such visit keeps the block alive that much longer.
      if (host !== undefined && refusedHosts.has(host)) {
        slowLaneJobs.push(job);
        continue;
      }

      const followed = await followJobLink(job, openPage, waitForLoad);

      // Only a refusal demotes a host. Every other failure is about the one
      // posting — a 404 is a job that is gone, and sending a whole site to
      // the slow lane over one dead posting would cost the rest of its jobs
      // for nothing.
      if (followed.reason === "page_refused") {
        if (host !== undefined) refusedHosts.add(host);
        slowLaneJobs.push(job);
        continue;
      }

      record(job, followed);
      await writeTrace(job, followed);
    }
  }

  const fastWorkerCount = Math.max(1, Math.min(fastConcurrency, dealt.length));
  await Promise.all(Array.from({ length: fastWorkerCount }, () => fastWorker()));

  let nextSlow = 0;

  async function slowWorker(): Promise<void> {
    // Only a worker's first job goes unpaused. It arrives after the whole
    // fast lane has run, which is cooling-off time already spent; everything
    // after it is another visit stacked on the one before.
    let tookFirst = false;

    while (nextSlow < slowLaneJobs.length) {
      const index = nextSlow;
      nextSlow += 1;

      if (tookFirst) await wait(slowPauseMs);
      tookFirst = true;

      const job = slowLaneJobs[index];
      if (!job) continue;

      const followed = await followJobLink(job, openPage, waitForLoad);

      // There is no third lane to defer to, so whatever comes back here —
      // another refusal included — is this job's answer for the run.
      record(job, followed);
      await writeTrace(job, followed);
    }
  }

  if (slowLaneJobs.length > 0) {
    const slowWorkerCount = Math.max(1, Math.min(slowConcurrency, slowLaneJobs.length));
    await Promise.all(Array.from({ length: slowWorkerCount }, () => slowWorker()));
  }

  // This step raises none today. The field is here because every step's
  // result carries it.
  return { jobs: resolvedJobs, warnings: [] };
}
