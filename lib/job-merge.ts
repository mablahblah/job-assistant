import { poolJobDates } from "./job-dates";
import type { JobListEntry, RawSalary } from "./job-list-entry";
import { sideRank } from "./source-priority";

// Everything a collector or a parser writes. Two copies of a job can disagree
// on these, so each one is settled by the source contest below.
export const CONTESTED_FIELDS = [
  "raw_company_name",
  "raw_company_slug",
  "raw_title",
  "title",
  "original_url",
  "resolved_url",
  "raw_location_list",
  "raw_mode_list",
  "normalized_mode_list",
  "raw_salary",
  "salary_low",
  "salary_high",
  "salary_period",
  "description",
] as const;

// Later pipeline phases own these, so the arriving copy simply lands.
export const WRITTEN_THROUGH_FIELDS = [
  "company_id",
  "is_resolved",
  "is_parsed",
  "is_classified",
  "status",
] as const;

// The row's record of which side won the contest.
export const WINNER_STAMP_FIELDS = ["collector", "parser"] as const;

// Set when the job first appears and left alone after that.
export const WRITE_ONCE_FIELDS = ["id", "collected_at"] as const;

// Gathered from both sides rather than picked from one.
export const POOLED_DATE_FIELDS = ["posting_date", "posting_updated_date"] as const;

// The database owns these, so the merge never puts them on the entry.
export const NEVER_WRITTEN_FIELDS = ["created_at", "modified_at"] as const;

// The five keys a raw salary can carry, each contested on its own.
const RAW_SALARY_KEYS = [
  "salary_min",
  "salary_max",
  "salary_period",
  "salary_currency",
  "salary_unit",
] as const;

// A value counts as filled when it actually says something. A source that
// collected nothing cannot be told from one that never looked, so an empty
// list, an empty object and an empty string all read the same as null.
function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Date) return true;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

// Picks the side whose values win a contested field. The lower rank wins; a
// listed source beats an unlisted one; an exact tie goes to the arriving copy,
// because a collector re-finding its own job every week is ordinary. With
// neither side listed, changing nothing is the safe move.
function pickWinner(
  existing: JobListEntry,
  arriving: JobListEntry,
  priorityList: readonly string[]
): JobListEntry {
  const existingRank = sideRank(priorityList, {
    collector: existing.collector,
    parser: existing.parser,
  });
  const arrivingRank = sideRank(priorityList, {
    collector: arriving.collector,
    parser: arriving.parser,
  });

  if (existingRank !== null && arrivingRank !== null) {
    return arrivingRank <= existingRank ? arriving : existing;
  }
  if (arrivingRank !== null) return arriving;
  return existing;
}

// Settles one value: a filled value always beats an empty one, so a better
// source that says nothing never erases what a worse one supplied. When both
// sides speak, the winning side is heard.
function contest(existingValue: unknown, arrivingValue: unknown, winnerValue: unknown): unknown {
  const existingFilled = isFilled(existingValue);
  const arrivingFilled = isFilled(arrivingValue);
  if (existingFilled && arrivingFilled) return winnerValue;
  if (existingFilled) return existingValue;
  if (arrivingFilled) return arrivingValue;
  return undefined;
}

// Contests the salary key by key, so a better-ranked source publishing only a
// period cannot wipe the low and high figures standing beside it.
function mergeRawSalary(
  existing: RawSalary | null | undefined,
  arriving: RawSalary | null | undefined,
  winner: RawSalary | null | undefined
): RawSalary | undefined {
  const merged: Record<string, unknown> = {};
  for (const key of RAW_SALARY_KEYS) {
    const value = contest(existing?.[key], arriving?.[key], winner?.[key]);
    if (value !== undefined) merged[key] = value;
  }

  // An all-empty salary is left off rather than written as an empty object.
  if (Object.keys(merged).length === 0) return undefined;
  // The keys come straight from RawSalary, so the shape is known good.
  return merged as RawSalary;
}

// Decides which copy of every job field survives when two versions of one job
// meet — a stored row against a fresh arrival, or two in-memory entries being
// deduped. Reaches no database.
export function mergeJobs(
  existing: JobListEntry,
  arriving: JobListEntry,
  priorityList: readonly string[],
  collectedAt: Date
): JobListEntry {
  const winner = pickWinner(existing, arriving, priorityList);

  // Built key by key: assigning undefined would still create the property, and
  // created_at, modified_at and delete_on_save must never appear at all.
  const merged: Record<string, unknown> = {};

  for (const field of CONTESTED_FIELDS) {
    // raw_salary is on the contested list so the completeness check sees it,
    // but it merges key by key rather than as one value.
    if (field === "raw_salary") continue;
    const value = contest(existing[field], arriving[field], winner[field]);
    if (value !== undefined) merged[field] = value;
  }

  const rawSalary = mergeRawSalary(existing.raw_salary, arriving.raw_salary, winner.raw_salary);
  if (rawSalary !== undefined) merged.raw_salary = rawSalary;

  // A later phase writes these through untouched. An explicit null is a real
  // value; only an absent key leaves the stored value standing, so a fresh
  // collection carrying no status cannot reset one the user already set.
  for (const field of WRITTEN_THROUGH_FIELDS) {
    const value = arriving[field] !== undefined ? arriving[field] : existing[field];
    if (value !== undefined) merged[field] = value;
  }

  // The row records who won, even though a single field may have survived from
  // the losing side. Per-field tracking would need a column per field.
  for (const field of WINNER_STAMP_FIELDS) {
    const value = winner[field];
    if (value !== undefined) merged[field] = value;
  }

  // Written when the job first appears. Two in-memory jobs may have no row
  // between them, so an absent id stays absent.
  const id = existing.id ?? arriving.id;
  if (id !== undefined && id !== null) merged.id = id;

  // The merged entry always carries a collection date.
  const mergedCollectedAt = existing.collected_at ?? arriving.collected_at ?? collectedAt;
  merged.collected_at = mergedCollectedAt;

  // Dates are pooled, not contested: the earliest posting stands and the latest
  // becomes the update, so two collectors disagreeing by hours do not look like
  // a repost.
  const pooled = poolJobDates(
    { posting_date: existing.posting_date, posting_updated_date: existing.posting_updated_date },
    { posting_date: arriving.posting_date, posting_updated_date: arriving.posting_updated_date },
    mergedCollectedAt
  );
  merged.posting_date = pooled.posting_date;
  merged.posting_updated_date = pooled.posting_updated_date;

  // The object is assembled field by field from JobListEntry values, so it
  // matches the type even though it was built as a loose record.
  return merged as JobListEntry;
}
