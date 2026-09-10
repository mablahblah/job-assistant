// Turns a job list into database rows: it creates what is new, updates what
// already exists, deletes what dedupe marked, and records what each write
// turned out to be. It runs at four points in the pipeline, after collection,
// resolution, parsing and classification, so every phase ends in a write and
// no phase depends on the one before it holding its list in memory.
//
// It reaches the job table only through the service it is handed, so it opens
// no database of its own and a fake serves its tests. Every rule about what a
// write does — the merge, the active-status freeze, the delete guard — lives
// in that service. This step is the loop that asks it and records the answer.
import type { JobService, JobWriteOutcome } from "../job-service";
import type { DeleteRefusedDetail, TraceDetail, TraceService } from "../trace-service";
import type { CollectionIssue } from "../collection-issue";
import type { JobListEntry } from "../job-list-entry";
import { saveWarnings, type SaveWarning } from "../save-warnings";
import { messageFromThrown } from "../thrown-message";

export interface SaveJobsOptions {
  jobService: JobService;
  priorityList: readonly string[];
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface SaveJobsResult {
  jobs: JobListEntry[];
  warnings: CollectionIssue[];
}

// A trace detail is cut at 200 characters. The only unbounded one this step
// writes is a thrown message, which has no length a driver promises to
// respect; a refused delete's detail is an id and a status, both already
// short.
const MAX_DETAIL_LENGTH = 200;

function truncate(value: string): string {
  return value.length > MAX_DETAIL_LENGTH ? value.slice(0, MAX_DETAIL_LENGTH) : value;
}

// One trace row this step wants written, without the fields the loop fills
// in from the entry and its caller.
interface TraceRowInput {
  event: string;
  reason?: string;
  detail?: TraceDetail;
}

// A SaveWarning without its collector. The per-entry work does not know which
// collector produced the job, so the loop stamps it on.
type WarningInput =
  | { kind: "delete_refused"; entry: JobListEntry; blockedBy: JobListEntry }
  | { kind: "db_write_failed"; entry: JobListEntry; thrown: unknown };

interface SaveEntryResult {
  // Null where the entry has nothing to report as saved: its row was deleted,
  // no row ever held its id, or the write never reached the database.
  job: JobListEntry | null;
  traceRow: TraceRowInput | null;
  warning: WarningInput | null;
}

// Every outcome the service can report, mapped to the event that records it.
// Naming the outcome type rather than plain string is what makes a new
// outcome fail to compile here instead of silently writing no row.
const EVENT_BY_OUTCOME: Record<JobWriteOutcome, string | null> = {
  created: "job_dbrow_created",
  updated: "job_dbrow_updated",
  status_updated: "job_dbrow_status_updated",
  // An active row the entry carried no status for. Nothing changed, so there
  // is nothing worth counting.
  unchanged: null,
};

async function deleteEntry(
  entry: JobListEntry,
  jobService: JobService
): Promise<SaveEntryResult> {
  // Dedupe only ever marks an entry that came out of a database row, so the
  // id is always there. The cast satisfies the service's signature.
  const result = await jobService.delete(entry.id as string);

  // The reason dedupe marked this entry rides onto every outcome below, so a
  // deletion is counted by the match that caused it rather than losing why.
  const reason = entry.delete_on_save;

  if (result.deleted) {
    return { job: null, traceRow: { event: "job_dbrow_deleted", reason }, warning: null };
  }

  if (result.blockedBy) {
    // The row holds a status the user has acted on, so the guard refused and
    // both rows stand. The entry stays in the list because its row is still
    // there, and the user is told so they can reconcile the pair by hand.
    // The row names which job blocked the delete and what status blocked it,
    // so the pair can be read off one line rather than looked up again.
    const detail: DeleteRefusedDetail = {
      blocked_by: result.blockedBy.id ?? "",
      status: result.blockedBy.status ?? "",
    };
    return {
      job: entry,
      traceRow: { event: "job_dbrow_delete_refused", reason, detail },
      warning: { kind: "delete_refused", entry, blockedBy: result.blockedBy },
    };
  }

  // No row held this id, so there is nothing to delete and nothing is wrong.
  // The entry was a copy that lost a merge and never reached a row of its
  // own, which is a dead end worth recording under the reason it lost.
  return { job: null, traceRow: { event: "abandoned", reason }, warning: null };
}

async function updateEntry(
  entry: JobListEntry,
  jobService: JobService,
  priorityList: readonly string[]
): Promise<SaveEntryResult> {
  const { job, outcome } = await jobService.update(entry, priorityList);
  const event = EVENT_BY_OUTCOME[outcome];

  return { job, traceRow: event === null ? null : { event }, warning: null };
}

async function saveEntry(
  entry: JobListEntry,
  jobService: JobService,
  priorityList: readonly string[]
): Promise<SaveEntryResult> {
  try {
    if (entry.delete_on_save) return await deleteEntry(entry, jobService);
    return await updateEntry(entry, jobService, priorityList);
  } catch (thrown) {
    // A throw is the only thing that stops a job here, and it covers a failed
    // delete and a failed write alike. The entry did not land, so it is both
    // traced as a dead end and reported to the user.
    return {
      job: null,
      traceRow: {
        event: "abandoned",
        reason: "db_write_failed",
        detail: truncate(messageFromThrown(thrown)),
      },
      warning: { kind: "db_write_failed", entry, thrown },
    };
  }
}

export async function saveJobs(
  jobs: JobListEntry[],
  options: SaveJobsOptions
): Promise<SaveJobsResult> {
  const { jobService, priorityList, trace, runId, step } = options;
  const savedJobs: JobListEntry[] = [];
  const warnings: SaveWarning[] = [];

  // Sequential and awaited, never Promise.all: these are writes to one table
  // through one service, and two entries pointing at the same row have to
  // settle in the order they arrived.
  for (const entry of jobs) {
    // The orchestrator stamps a collector onto every job, so the fallback is
    // never reached by a job a real run produced.
    const collector = entry.collector ?? "unknown";
    const { job, traceRow, warning } = await saveEntry(entry, jobService, priorityList);

    if (job !== null) savedJobs.push(job);

    // The warning goes up whatever else the entry is missing. A job that
    // never reached the database is the one thing the user has to be told.
    if (warning !== null) warnings.push({ ...warning, collector });

    // A trace row is keyed on the job's id, so an entry carrying none has
    // nothing to key one on. All three of trace, runId and step are needed as
    // well: a step handed only some of them still does its saving and stays
    // silent, which is what lets it run outside a job search.
    if (traceRow !== null && entry.id && trace && runId !== undefined && step !== undefined) {
      await trace.write({
        run_id: runId,
        job_id: entry.id,
        step,
        event: traceRow.event,
        collector,
        reason: traceRow.reason,
        detail: traceRow.detail,
      });
    }
  }

  return { jobs: savedJobs, warnings: saveWarnings(warnings) };
}
