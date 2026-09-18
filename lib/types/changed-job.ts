// What one status change came to. The handler that writes the change and the
// report that prints it both read this shape, so it lives here rather than in
// either of them — a plain function may not reach up into a handler for it.
//
// Every outcome either says an entry was written or says one was not. The
// skill driving a run reads the outcome to decide whether to come back with
// an employer name, so the set is fixed rather than free text.
export type ChangeOutcome =
  | "changed"
  | "no_such_job"
  | "needs_company_name"
  | "no_title"
  | "entry_failed";

export interface ChangedJob {
  job_id: string;
  status: string;
  outcome: ChangeOutcome;
  entry_written: boolean;
  company_id: string | null;
  company_name: string | null;
  // The place this job's location matched, carried back because the search
  // that runs next puts it into the query — a common employer name finds the
  // wrong business on its own. A job moved straight out of the backlog was
  // never classified and matched no place, so this is often empty.
  place: string | null;
}
