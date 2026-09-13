// The type a job takes while it travels in memory during collection, before
// anything is saved. It maps one to one onto the Job database row, so a
// collector and the row it eventually becomes never quietly disagree.
//
// raw_location_list, raw_mode_list, normalized_mode_list, and raw_salary are
// typed here as a real array or object, not the Json column Prisma gives them,
// so they replace Job's Json typing. delete_on_save is the one field that is
// not a column: a later phase sets it on an entry it wants removed.
//
// Every field is optional because a collector fills only what its source
// supplied and leaves the rest empty.
import type { Job } from "../../generated/pipeline/client";

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

// Every reason dedupe can write onto a trace row, in the order the Trace
// model's comment in prisma/schema.prisma names them. That comment describes
// the same four words, and a test in prisma/schema.test.ts reads this list to
// check it, so the two cannot drift apart.
export const DEDUPE_TRACE_REASONS = [
  "hard_match_in_list",
  "repost_match_in_list",
  "matched_db_row",
  "matched_list_entry",
] as const;

export type DedupeTraceReason = (typeof DEDUPE_TRACE_REASONS)[number];

// The one reason that never marks an entry away: it sits on a stored row that
// joined the list, rather than on an entry leaving it.
const REASON_ON_A_JOINING_ROW = "matched_list_entry";

// The reasons dedupe can mark an entry away for — the four above minus the
// joining-row one. The trace row written when the entry goes carries the same
// word, so the match that removed a job is named rather than merely counted.
export type DedupeReason = Exclude<DedupeTraceReason, typeof REASON_ON_A_JOINING_ROW>;

export const DEDUPE_REASONS: readonly DedupeReason[] = DEDUPE_TRACE_REASONS.filter(
  (reason): reason is DedupeReason => reason !== REASON_ON_A_JOINING_ROW
);

// Every reason a step can mark an entry away for: dedupe's three, plus the one
// resolution adds when a job's resolution reaches a blacklisted host and the row has to go.
// Dedupe gains no right to write that word — DedupeReason stays the narrower
// type its own code is held to.
export type DeleteOnSaveReason = DedupeReason | "blacklisted_url";

// Derived from DEDUPE_REASONS rather than retyping those three, so a change to
// what dedupe may set cannot leave this list behind.
export const DELETE_ON_SAVE_REASONS: readonly DeleteOnSaveReason[] = [
  ...DEDUPE_REASONS,
  "blacklisted_url",
];

// What a shared field mapper hands back: a job's fields and nothing else.
// A collector and a parser read the same source response and must agree about
// what it means, so both call one mapper. But the two disagree about the rest
// of the entry — a collector builds the posting's link and opens the phase
// gates, while a parser already holds a resolved link and is about to close
// the parsing gate. Leaving those five fields out of the type means a mapper
// cannot overwrite a link or reset a gate it does not own.
export type MappedJobFields = Omit<
  JobListEntry,
  "original_url" | "resolved_url" | "is_resolved" | "is_parsed" | "is_classified"
>;

export type JobListEntry = Omit<
  Partial<Job>,
  "raw_location_list" | "raw_mode_list" | "normalized_mode_list" | "raw_salary"
> & {
  raw_location_list?: string[] | null;
  raw_mode_list?: string[] | null;
  normalized_mode_list?: string[] | null;
  raw_salary?: RawSalary | null;
  delete_on_save?: DeleteOnSaveReason;
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
  "title",
  "original_url",
  "original_url_match_key",
  "resolved_url",
  "resolved_url_match_key",
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
  "normalized_mode_list",
  "collector",
  "collected_at",
  "parser",
  "raw_salary",
  "salary_low",
  "salary_high",
  "salary_period",
  "description",
  "delete_on_save",
] as const satisfies readonly (keyof JobListEntry)[];
