// The type a job takes while it travels in memory during collection, before
// anything is saved. It maps one to one onto the Job database row, so a
// collector and the row it eventually becomes never quietly disagree.
//
// original_location_list and original_mode_list are real arrays here and
// only become JSON columns at the database, so they replace Job's Json
// typing. delete_on_save is the one field that is not a column: a later
// phase sets it on an entry it wants removed.
//
// Every field is optional because a collector fills only what its source
// supplied and leaves the rest empty.
import type { Job } from "../generated/pipeline/client";

export type JobListEntry = Omit<
  Partial<Job>,
  "original_location_list" | "original_mode_list"
> & {
  original_location_list?: string[];
  original_mode_list?: string[];
  delete_on_save?: boolean;
};

// Every Job column in schema order, plus delete_on_save last. The
// `satisfies` clause ties this list to JobListEntry, so a name that is not a
// field of the type fails to compile.
export const JOB_LIST_ENTRY_FIELDS = [
  "id",
  "company_id",
  "company_name",
  "original_title",
  "original_url",
  "resolved_url",
  "posting_date",
  "posting_updated_date",
  "created_at",
  "modified_at",
  "is_resolved",
  "is_parsed",
  "is_classified",
  "status",
  "original_location_list",
  "original_mode_list",
  "collector",
  "salary_raw",
  "salary_low",
  "salary_high",
  "salary_period",
  "description",
  "delete_on_save",
] as const satisfies readonly (keyof JobListEntry)[];
