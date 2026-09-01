// Writes every Trace row for the pipeline. A job enters at collection, passes
// through each pipeline step, and either reaches the end or hits a dead end
// recording when and why. Routing every write through this one service keeps
// every row the same shape.
import type { createPipelineDb } from "./pipeline-db";

// What is specific to one event. A dead end at collection names the offending
// value on its own; a normalization carries the value before and after. The
// column behind it is Json, so both shapes store as they are.
export type TraceDetail = string | { from: string; to: string };

export interface TraceEvent {
  run_id: string;
  job_id: string;
  step: string;
  event: string;
  collector: string;
  reason?: string;
  detail?: TraceDetail;
}

export interface TraceWriter {
  write(event: TraceEvent): Promise<void>;
  failureCount(): number;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

export function createTraceWriter(db: PipelineDb): TraceWriter {
  let failures = 0;

  return {
    async write(event: TraceEvent) {
      try {
        await db.trace.create({
          data: {
            run_id: event.run_id,
            job_id: event.job_id,
            step: event.step,
            event: event.event,
            collector: event.collector,
            // Omitted fields fall through as undefined, which Prisma writes
            // as SQL NULL rather than as any column default.
            reason: event.reason,
            detail: event.detail,
          },
        });
      } catch {
        // This runs inside the collection orchestrator's try block around
        // each collector call, where a throw reads as a collector failure
        // and costs every remaining job from that source. Losing a trace
        // row is better than losing the rest of the run, so the failure is
        // swallowed and counted instead.
        failures += 1;
      }
    },

    failureCount() {
      return failures;
    },
  };
}
