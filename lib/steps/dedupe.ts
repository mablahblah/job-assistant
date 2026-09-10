// Reduces a job list to one entry per real posting, in two passes. The list
// compare folds entries that match each other; the database compare folds each
// survivor in with the stored rows it reaches through the job service's three
// lookups. Comparing the list first means each surviving job costs one lookup
// instead of every duplicate paying for its own.
//
// It reads the job table only through the service it is handed and never
// writes or deletes a row, so it opens no database of its own and a fake
// serves its tests. A loser rides the returned list carrying delete_on_save,
// and the save step downstream is what removes it.
import { foldMatchingJobs } from "../job-dedupe";
import { matchingClause } from "../job-identity";
import { mergeJobs, pickWinner } from "../job-merge";
import { urlMatchKey } from "../url-match-key";
import { dedupeWarnings } from "../dedupe-warnings";
import type { DedupeWarning } from "../dedupe-warnings";
import type { JobIdentityClause } from "../job-identity";
import type { JobService } from "../job-service";
import type { TraceService } from "../trace-service";
import type { CollectionIssue } from "../collection-issue";
import type { JobListEntry } from "../job-list-entry";

// The mark a job carries when it lost to a stored row, and the reason the
// trace row gives for that departure.
const MATCHED_DB_ROW = "matched_db_row";

export interface DedupeJobsOptions {
  jobService: JobService;
  priorityList: readonly string[];
  collectedAt: Date;
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface DedupeJobsResult {
  jobs: JobListEntry[];
  warnings: CollectionIssue[];
}

// A stored row the lookups reached and the clause that confirmed it is the
// same job as the entry. The clause is kept because a trace row records it.
interface ConfirmedRow {
  id: string;
  row: JobListEntry;
  clause: JobIdentityClause;
}

// A trace row waiting for its run id and step name, keyed on the job it
// describes rather than on the entry being compared.
interface PendingTrace {
  job: JobListEntry;
  event: string;
  reason: string;
}

interface PairFold {
  merged: JobListEntry;
  loser: JobListEntry;
}

export async function dedupeJobs(
  jobs: JobListEntry[],
  options: DedupeJobsOptions
): Promise<DedupeJobsResult> {
  const { jobService, priorityList, collectedAt, trace, runId, step } = options;

  // Entries and rows that lost. They stay on the returned list so the save
  // step can act on the mark they carry.
  const marked: JobListEntry[] = [];
  const warnings: DedupeWarning[] = [];
  const pending: PendingTrace[] = [];

  // Pass one: entries that match each other on the list. Each loser already
  // carries the delete_on_save the save step reads.
  const { jobs: listSurvivors, folds } = foldMatchingJobs(jobs, priorityList, collectedAt);
  for (const fold of folds) {
    marked.push(fold.loser);
    const reason = fold.loser.delete_on_save;
    if (reason) pending.push({ job: fold.loser, event: "abandoned", reason });
  }

  // Every id the caller handed in. A row wearing one of these is some list
  // entry's own row, not a second job standing beside it, and skipping the
  // whole list rather than only the entry's own id also stops one entry
  // claiming another entry's row.
  const listIds = new Set<string>();
  for (const job of jobs) {
    if (job.id) listIds.add(job.id);
  }

  // Pass two: each survivor against the stored rows it reaches.
  const survivors: JobListEntry[] = [];
  // Row id to the position of the survivor now holding that row.
  const claims = new Map<string, number>();

  for (const entry of listSurvivors) {
    let confirmed: ConfirmedRow[];
    try {
      confirmed = await findMatchingRows(entry, jobService, listIds);
    } catch (thrown) {
      // Under-merging leaves a duplicate the user can see and delete;
      // over-merging destroys a job nobody knows is gone. So a failed lookup
      // leaves the entry exactly as it arrived and only raises a warning.
      // The collector fallback matches the save step: a real run stamps one
      // onto every job, so it is never reached there either.
      warnings.push({
        kind: "lookup_failed",
        collector: entry.collector ?? "unknown",
        entry,
        thrown,
      });
      survivors.push(entry);
      continue;
    }

    // An entry reaching a row an earlier entry already holds is that same job
    // seen twice, so it joins that claim rather than standing beside it.
    const claimIndex = claimIndexFor(confirmed, claims);
    const claim = claimIndex === undefined ? undefined : survivors[claimIndex];
    // Either the claim's own place, or the end of the list, where an entry
    // holding no claim lands when it is written back below.
    const index = claimIndex ?? survivors.length;
    let current = entry;

    if (claim) {
      // The claim already holds a stored row, so it is the earlier side.
      const fold = foldPair(claim, entry, priorityList, collectedAt);
      current = fold.merged;
      marked.push(fold.loser);
      pending.push(leavingRow(fold.loser));
    }

    for (const { id, row } of confirmed) {
      // A row an earlier entry already folded in stays where it is.
      if (claims.has(id)) continue;

      // A stored row is the earlier side, matching how the save step calls
      // mergeJobs(stored, entry): order settles the tie-break, which the
      // later side wins, and the collection date, which the earlier supplies.
      const fold = foldPair(row, current, priorityList, collectedAt);
      current = fold.merged;
      marked.push(fold.loser);
      pending.push(leavingRow(fold.loser));
      // The row is the job this event describes, so it supplies both the id
      // and the collector, whether or not its own id went on to survive.
      pending.push({ job: row, event: "added_to_job_list", reason: "matched_list_entry" });
      claims.set(id, index);
    }

    survivors[index] = current;
  }

  // All three of trace, runId and step are needed before a row is written. A
  // step handed only some of them still does its work and stays silent, which
  // is what lets the same function run outside a job search.
  if (trace && runId !== undefined && step !== undefined) {
    for (const row of pending) {
      // A trace row is keyed by job id and collector, so a side carrying
      // neither has nothing to key its record on.
      if (!row.job.id || !row.job.collector) continue;
      await trace.write({
        run_id: runId,
        job_id: row.job.id,
        step,
        event: row.event,
        collector: row.job.collector,
        reason: row.reason,
      });
    }
  }

  return { jobs: [...survivors, ...marked], warnings: dedupeWarnings(warnings) };
}

// Asks the table its three questions about one entry and keeps the rows a
// clause confirms are the same job.
async function findMatchingRows(
  entry: JobListEntry,
  jobService: JobService,
  listIds: ReadonlySet<string>
): Promise<ConfirmedRow[]> {
  const found = new Map<string, JobListEntry>();

  // All three lookups run every time. A row from the first never stops the
  // others: each asks a different question and each can name a different row,
  // and rows that all match the entry are one job however they were reached.
  const originalKey =
    typeof entry.original_url === "string" ? urlMatchKey(entry.original_url) : undefined;
  if (originalKey) {
    collectRows(found, await jobService.findByOriginalUrlMatchKey(originalKey), listIds);
  }

  const resolvedKey =
    typeof entry.resolved_url === "string" ? urlMatchKey(entry.resolved_url) : undefined;
  if (resolvedKey) {
    collectRows(found, await jobService.findByResolvedUrlMatchKey(resolvedKey), listIds);
  }

  if (entry.company_id && entry.title) {
    collectRows(
      found,
      await jobService.findByCompanyAndTitle(entry.company_id, entry.title),
      listIds
    );
  }

  const confirmed: ConfirmedRow[] = [];
  for (const [id, row] of found) {
    // A lookup matches on columns alone. Company and title also needs the two
    // sides' dates close together and the shared-host veto applied, which only
    // the clause does, so a row it cannot place is left where it is.
    const clause = matchingClause(row, entry);
    if (clause) confirmed.push({ id, row, clause });
  }
  return confirmed;
}

// Holds each row once, however many lookups named it, and drops the ones this
// step has no business touching.
function collectRows(
  found: Map<string, JobListEntry>,
  rows: readonly JobListEntry[],
  listIds: ReadonlySet<string>
): void {
  for (const row of rows) {
    if (!row.id || listIds.has(row.id) || found.has(row.id)) continue;
    found.set(row.id, row);
  }
}

// The position of the survivor already holding one of these rows, where there
// is one.
function claimIndexFor(
  confirmed: readonly ConfirmedRow[],
  claims: ReadonlyMap<string, number>
): number | undefined {
  for (const { id } of confirmed) {
    const index = claims.get(id);
    if (index !== undefined) return index;
  }
  return undefined;
}

// Merges two sides of the same job. pickWinner gives the id to whichever side
// holds a created_at, the signal for already holding a database row, so a
// stored row's id always survives against a fresh entry.
function foldPair(
  earlier: JobListEntry,
  later: JobListEntry,
  priorityList: readonly string[],
  collectedAt: Date
): PairFold {
  const merged = mergeJobs(earlier, later, priorityList, collectedAt);
  const { idSurvivor } = pickWinner(earlier, later, priorityList);
  const loser = idSurvivor === earlier ? later : earlier;
  return {
    // The merged entry is what goes on to meet the next side.
    merged,
    // A copy, so the input list is never written to.
    loser: { ...loser, delete_on_save: MATCHED_DB_ROW },
  };
}

// A side carrying a created_at already held a database row, so its departure
// is a row being deleted rather than an entry simply leaving the list.
function leavingRow(loser: JobListEntry): PendingTrace {
  return {
    job: loser,
    event: loser.created_at ? "job_dbrow_deleted" : "abandoned",
    reason: MATCHED_DB_ROW,
  };
}
