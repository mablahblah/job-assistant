// Owns the work log table — one row per job search activity recorded for the
// Texas Workforce Commission. Nothing else in the codebase writes to it.
//
// The entry carries the employer name and the job title as plain values
// copied onto the row rather than read through to the rows holding them, and
// its job id is a plain column with no relation. A filing already made
// therefore survives the job or the employer behind it changing or going
// away.
//
// Nothing revises an entry, so there is no update here and no last-changed
// column on the row. Writing the same entry twice is allowed: moving a job to
// the same triggering status again writes a second row, and telling a real
// second application from an accidental repeat needs a decision of its own.
import type { createPipelineDb } from "../db/pipeline-db";

type PipelineDb = ReturnType<typeof createPipelineDb>;

export interface WorkLogInput {
  job_id: string;
  company_name: string;
  job_title: string;
  activity: string;
  // Only the phase 13 migration supplies this, carrying the old activity's
  // date so a migrated filing lands in its real TWC week. Live callers omit
  // it; the row takes the write's moment.
  created_at?: Date;
}

export interface WorkLogRecord extends WorkLogInput {
  id: string;
  created_at: Date;
}

export interface WorkLogService {
  write(entry: WorkLogInput): Promise<WorkLogRecord>;
  // The dashboard's work log page reads through the service that owns this
  // table rather than the database. Every entry rather than one week's worth,
  // because the page groups them into weeks itself and a week nothing was
  // filed in still has to appear.
  findAll(): Promise<WorkLogRecord[]>;
}

export function createWorkLogService(db: PipelineDb): WorkLogService {
  return {
    // No try block here, deliberately unlike the trace service. Tracing
    // swallows a failed write and counts it, because losing a trace row is
    // cheaper than losing the rest of a run. This row is a legal filing that
    // cannot be regenerated once its week has passed, so a failure has to
    // reach the caller rather than leave the user believing a record exists.
    async write(entry: WorkLogInput) {
      return db.workLogEntry.create({ data: entry });
    },

    async findAll() {
      return db.workLogEntry.findMany({ orderBy: { created_at: "desc" } });
    },
  };
}
