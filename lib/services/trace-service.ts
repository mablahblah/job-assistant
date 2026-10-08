// Writes every Trace row for the pipeline, and reads one run's rows back as a
// summary. A job enters at collection, passes
// through each pipeline step, and either reaches the end or hits a dead end
// recording when and why. Routing every write through this one service keeps
// every row the same shape.
import type { createPipelineDb } from "../db/pipeline-db";

// What dedupe writes when a job merged away: the id it became, which clause
// matched, and enough of the losing side to check the merge afterwards rather
// than only count it. The clause is a plain string so this service stays
// clear of dedupe's own vocabulary; the step supplies the wording.
//
// A type rather than an interface: Prisma's Json input wants an index
// signature, which TypeScript gives a type alias and withholds from an
// interface, so an interface here fails to compile at the write.
export type DedupeTraceDetail = {
  became: string;
  clause: string;
  company: string;
  title: string;
  original_url: string;
  posting_date: string;
};

// What save writes when the active-status guardrail refuses a delete: the row
// that blocked it and the status that made it block, so the pair can be
// reconciled without going back to the table for a second look.
export type DeleteRefusedDetail = {
  blocked_by: string;
  status: string;
};

// What is specific to one event. A dead end at collection names the offending
// value on its own; a normalization carries the value before and after; the
// two shapes above belong to dedupe and to the delete it asked for. The
// column behind it is Json, so every shape stores as it is.
export type TraceDetail =
  | string
  | { from: string; to: string }
  | DedupeTraceDetail
  | DeleteRefusedDetail;

// What every row carries, whether it describes a job or a company.
interface TraceEventBase {
  run_id: string;
  step: string;
  event: string;
  reason?: string;
  // The owned domain a failing source is counted under. Only the events that
  // blame a source fill it.
  domain?: string;
  detail?: TraceDetail;
}

// A job's event. It names the job and the collector that produced it, and
// never a company.
interface JobTraceEvent extends TraceEventBase {
  job_id: string;
  collector: string;
  company_id?: never;
}

// A company's event, which scoring writes. It names the company and nothing
// else: a company score has no posting behind it, so there is no job to name,
// and no collector produced it either. Spelling both as never is what makes a
// row carrying a job and a company fail to compile.
interface CompanyTraceEvent extends TraceEventBase {
  company_id: string;
  job_id?: never;
  collector?: never;
}

// One row describes a job or a company, never both.
export type TraceEvent = JobTraceEvent | CompanyTraceEvent;

// One group's tally from a run: every row sharing a step, event, reason,
// collector and domain, collapsed to a count. reason and domain stay nullable
// rather than optional because a row with no reason, or no domain, is a real,
// present group of its own, not an absent field.
export interface TraceRunCount {
  step: string;
  event: string;
  reason: string | null;
  // Empty on a company event's group, which has no collector behind it.
  collector: string | null;
  domain: string | null;
  count: number;
}

// One row of a run's history for a named job: the step and event it hit,
// and the reason if one was written. Its own type, not TraceRunCount,
// because a row is a single write, not a group's tally.
export interface TraceJobRecord {
  job_id: string;
  step: string;
  event: string;
  reason: string | null;
}

// Kept apart from TraceService so the ~21 hand-built TraceService stand-ins
// in other tests don't need this method too. Only the add-external-jobs
// runner asks for it, as TraceService & TraceJobRowsReader.
export interface TraceJobRowsReader {
  rowsForJobs(runId: string, jobIds: string[]): Promise<TraceJobRecord[]>;
}

export interface TraceService {
  write(event: TraceEvent): Promise<void>;
  failureCount(): number;
  countsForRun(runId: string): Promise<TraceRunCount[]>;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

export function createTraceService(db: PipelineDb): TraceService & TraceJobRowsReader {
  let failures = 0;

  return {
    async write(event: TraceEvent) {
      try {
        await db.trace.create({
          data: {
            run_id: event.run_id,
            job_id: event.job_id,
            company_id: event.company_id,
            step: event.step,
            event: event.event,
            collector: event.collector,
            // Omitted fields fall through as undefined, which Prisma writes
            // as SQL NULL rather than as any column default.
            reason: event.reason,
            domain: event.domain,
            detail: event.detail,
          },
        });
      } catch {
        // This runs inside the collection orchestrator's try block around
        // each collector call, where a throw reads as a collector failure
        // and costs every remaining job from that source. Losing a trace
        // row is better than losing the rest of the run, so the failure is
        // ignored and counted instead.
        failures += 1;
      }
    },

    failureCount() {
      return failures;
    },

    async countsForRun(runId: string) {
      // A throw here is left to travel, unlike write's: a summary that
      // silently read back nothing would tell the user the run did nothing,
      // which is worse than an error reaching them instead.
      const groups = await db.trace.groupBy({
        by: ["step", "event", "reason", "collector", "domain"],
        where: { run_id: runId },
        _count: { _all: true },
      });

      // Prisma's _count shape is its own; callers of this method see only the
      // flat count field, never Prisma's vocabulary.
      return groups.map((group) => ({
        step: group.step,
        event: group.event,
        reason: group.reason,
        collector: group.collector,
        domain: group.domain,
        count: group._count._all,
      }));
    },

    async rowsForJobs(runId: string, jobIds: string[]) {
      // Nothing was named, so there is nothing to read back.
      if (jobIds.length === 0) {
        return [];
      }

      const rows = await db.trace.findMany({
        where: { run_id: runId, job_id: { in: jobIds } },
        orderBy: { id: "asc" },
        select: { job_id: true, step: true, event: true, reason: true },
      });

      // job_id is nullable on the table in general, but every row here was
      // matched against the named ids, so it is always one of them.
      return rows.map((row) => ({
        job_id: row.job_id as string,
        step: row.step,
        event: row.event,
        reason: row.reason,
      }));
    },
  };
}
