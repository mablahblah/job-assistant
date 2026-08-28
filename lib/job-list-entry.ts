// The type a job takes while it travels in memory during collection, before
// anything is saved. It maps one to one onto the Job database row, so a
// collector and the row it eventually becomes never quietly disagree.
//
// raw_location_list, raw_mode_list, and raw_salary are typed here as a real
// array or object, not the Json column Prisma gives them, so they replace
// Job's Json typing. delete_on_save is the one field that is not a column: a
// later phase sets it on an entry it wants removed.
//
// Every field is optional because a collector fills only what its source
// supplied and leaves the rest empty.
import type { Job } from "../generated/pipeline/client";

// The salary a source published, exactly as it published it. A collector sets
// only the keys its source gave it, and a key the source said nothing about is
// left off rather than filled with a placeholder. The keys are the same five
// whatever the source, which is what lets one normalizer read every source
// instead of branching on which collector produced the job.
//
// salary_unit exists because no figure carries its unit on its face —
// 14000000 is a plausible salary in cents and in pesos alike — and only the
// collector knows which its own API sends.
export interface RawSalary {
  salary_min?: number;
  salary_max?: number;
  salary_period?: string;
  salary_currency?: string;
  salary_unit?: "cents";
}

export type JobListEntry = Omit<
  Partial<Job>,
  "raw_location_list" | "raw_mode_list" | "raw_salary"
> & {
  raw_location_list?: string[];
  raw_mode_list?: string[];
  raw_salary?: RawSalary;
  delete_on_save?: boolean;
};

// Every Job column in schema order, plus delete_on_save last. The
// `satisfies` clause ties this list to JobListEntry, so a name that is not a
// field of the type fails to compile.
export const JOB_LIST_ENTRY_FIELDS = [
  "id",
  "company_id",
  "raw_company_name",
  "raw_company_slug",
  "raw_title",
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
  "raw_location_list",
  "raw_mode_list",
  "collector",
  "raw_salary",
  "salary_low",
  "salary_high",
  "salary_period",
  "description",
  "delete_on_save",
] as const satisfies readonly (keyof JobListEntry)[];
