import { poolJobDates } from "./job-dates";
import type { JobListEntry, RawSalary } from "../types/job-list-entry";
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
  "normalized_location_list",
  "raw_mode_list",
  "normalized_mode_list",
  "raw_salary",
  "salary_low",
  "salary_high",
  "salary_period",
  "description",
] as const;

// Later pipeline phases own these, so the later copy simply lands. An explicit
// null is a real value here and empties the column; only an absent key leaves
// the stored value standing.
//
// The two scoring fields sit here for that reason. A collector re-finding a
// job carries no score, so the stored one stands — a merge settles two
// collectors disagreeing about a posting, and neither has an opinion about
// how well the job fits the user. Promotion is the one thing that empties
// them, and it does so by setting an explicit null.
export const WRITTEN_THROUGH_FIELDS = [
  "company_id",
  "alignment_score",
  "alignment_rationale",
  "is_resolved",
  "is_parsed",
  "is_classified",
  "status",
  "location_match",
  "location_match_place",
  "location_match_mode",
  "is_repost",
] as const;

// The row's record of which side won the contest.
export const WINNER_WRITTEN_FIELDS = ["collector", "parser"] as const;

// Set when the job first appears and left alone after that.
export const WRITE_ONCE_FIELDS = ["id", "collected_at"] as const;

// Gathered from both sides rather than picked from one.
export const POOLED_DATE_FIELDS = ["posting_date", "posting_updated_date"] as const;

// The database rewrites this on every write, so the merge never puts it on
// the entry.
export const NEVER_WRITTEN_FIELDS = ["modified_at"] as const;

// The job service builds these from the links at write time, so the merge
// never puts them on the entry either. A key settled here could disagree with
// the link the contest above picked.
export const DERIVED_AT_WRITE_FIELDS = [
  "original_url_match_key",
  "resolved_url_match_key",
] as const;

// The merge settles this one and carries it on the entry while the job
// travels in memory, where it is the signal for whether a side holds a
// database row. The job service strips it just before the write, so a stored
// row keeps its own birthday. That is the opposite of the group above, which
// the job service builds at write time rather than strips.
export const STRIPPED_AT_WRITE_FIELDS = ["created_at"] as const;

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

// The two answers a merge needs about a pair of jobs: whose values win a
// contested field, and whose id and created_at survive. The two often differ,
// because a better source can arrive on a side that was never saved.
export interface WinnerPick {
  dataWinner: JobListEntry;
  idWinner: JobListEntry;
}

// Decides whose id survives. created_at is the only field a job carries that
// the database fills rather than the pipeline, so it marks a side that
// already holds a row. Between two rows the older one survives, because it
// carries the earlier first-seen date, its own trace rows and, from Phase 11,
// the work log entry pointing at its id. A row beats an entry that was never
// saved whatever the priority list says. With neither side saved there is no
// history to protect, so the data winner's id rides along.
function pickIdWinner(
  earlier: JobListEntry,
  later: JobListEntry,
  dataWinner: JobListEntry
): JobListEntry {
  const earlierCreated = earlier.created_at;
  const laterCreated = later.created_at;

  if (earlierCreated !== undefined && laterCreated !== undefined) {
    return earlierCreated <= laterCreated ? earlier : later;
  }
  if (earlierCreated !== undefined) return earlier;
  if (laterCreated !== undefined) return later;
  return dataWinner;
}

// Picks both winners. The data winner follows source priority: the lower rank
// wins; a listed source beats an unlisted one; an exact tie goes to the later
// copy, because a collector re-finding its own job every week is ordinary.
// With neither side listed, changing nothing is the safe move. The id
// survivor follows the separate rule above.
export function pickWinner(
  earlier: JobListEntry,
  later: JobListEntry,
  priorityList: readonly string[]
): WinnerPick {
  const earlierRank = sideRank(priorityList, {
    collector: earlier.collector,
    parser: earlier.parser,
  });
  const laterRank = sideRank(priorityList, {
    collector: later.collector,
    parser: later.parser,
  });

  let dataWinner: JobListEntry;
  if (earlierRank !== null && laterRank !== null) {
    dataWinner = laterRank <= earlierRank ? later : earlier;
  } else if (laterRank !== null) {
    dataWinner = later;
  } else {
    dataWinner = earlier;
  }

  return { dataWinner, idWinner: pickIdWinner(earlier, later, dataWinner) };
}

// Settles one value: a filled value always beats an empty one, so a better
// source that says nothing never erases what a worse one supplied. When both
// sides speak, the winning side is heard.
function contest(earlierValue: unknown, laterValue: unknown, winnerValue: unknown): unknown {
  const earlierFilled = isFilled(earlierValue);
  const laterFilled = isFilled(laterValue);
  if (earlierFilled && laterFilled) return winnerValue;
  if (earlierFilled) return earlierValue;
  if (laterFilled) return laterValue;
  return undefined;
}

// Contests the salary key by key, so a better-ranked source publishing only a
// period cannot wipe the low and high figures standing beside it.
function mergeRawSalary(
  earlier: RawSalary | null | undefined,
  later: RawSalary | null | undefined,
  winner: RawSalary | null | undefined
): RawSalary | undefined {
  const merged: Record<string, unknown> = {};
  for (const key of RAW_SALARY_KEYS) {
    const value = contest(earlier?.[key], later?.[key], winner?.[key]);
    if (value !== undefined) merged[key] = value;
  }

  // An all-empty salary is left off rather than written as an empty object.
  if (Object.keys(merged).length === 0) return undefined;
  // The keys come straight from RawSalary, so the shape is known good.
  return merged as RawSalary;
}

// Decides which copy of every job field survives when two versions of one job
// meet — a stored row against a fresh arrival, or two in-memory entries being
// deduped. Argument order settles only the tie-break, which the later side
// wins, and the collection date, which the earlier side supplies. Reaches no
// database.
export function mergeJobs(
  earlier: JobListEntry,
  later: JobListEntry,
  priorityList: readonly string[],
  collectedAt: Date
): JobListEntry {
  const { dataWinner, idWinner } = pickWinner(earlier, later, priorityList);
  const idLoser = idWinner === earlier ? later : earlier;

  // Built key by key: assigning undefined would still create the property, and
  // modified_at and delete_on_save must never appear at all.
  const merged: Record<string, unknown> = {};

  for (const field of CONTESTED_FIELDS) {
    // raw_salary is on the contested list so the completeness check sees it,
    // but it merges key by key rather than as one value.
    if (field === "raw_salary") continue;
    const value = contest(earlier[field], later[field], dataWinner[field]);
    if (value !== undefined) merged[field] = value;
  }

  const rawSalary = mergeRawSalary(earlier.raw_salary, later.raw_salary, dataWinner.raw_salary);
  if (rawSalary !== undefined) merged.raw_salary = rawSalary;

  // A later phase writes these through untouched. An explicit null is a real
  // value; only an absent key leaves the stored value standing, so a fresh
  // collection carrying no status cannot reset one the user already set.
  for (const field of WRITTEN_THROUGH_FIELDS) {
    const value = later[field] !== undefined ? later[field] : earlier[field];
    if (value !== undefined) merged[field] = value;
  }

  // The row records who won, even though a single field may have survived from
  // the losing side. Per-field tracking would need a column per field.
  for (const field of WINNER_WRITTEN_FIELDS) {
    const value = dataWinner[field];
    if (value !== undefined) merged[field] = value;
  }

  // Written when the job first appears. The surviving side supplies it, and a
  // filled value beats an empty one, so a survivor carrying no id yields to
  // the other side's. Two in-memory jobs may have no id between them, so an
  // absent id stays absent.
  const id = idWinner.id ?? idLoser.id;
  if (id !== undefined && id !== null) merged.id = id;

  // The birthday travels with the id it belongs to, taken from the surviving
  // side rather than the side whose data won. Without it a group of three
  // folded pairwise loses the has-a-row signal after the first fold, and the
  // second fold reads a saved side as fresh and gives its id away.
  if (idWinner.created_at !== undefined) merged.created_at = idWinner.created_at;

  // The merged entry always carries a collection date.
  const mergedCollectedAt = earlier.collected_at ?? later.collected_at ?? collectedAt;
  merged.collected_at = mergedCollectedAt;

  // Dates are pooled, not contested: the earliest posting stands and the latest
  // becomes the update, so no real date is thrown away. Two collectors
  // disagreeing by hours still leave two distinct dates, so the row does read
  // as updated; judging whether that gap is a real repost belongs to
  // classification, not here.
  const pooled = poolJobDates(
    { posting_date: earlier.posting_date, posting_updated_date: earlier.posting_updated_date },
    { posting_date: later.posting_date, posting_updated_date: later.posting_updated_date },
    mergedCollectedAt
  );
  merged.posting_date = pooled.posting_date;
  merged.posting_updated_date = pooled.posting_updated_date;

  // The object is assembled field by field from JobListEntry values, so it
  // matches the type even though it was built as a loose record.
  return merged as JobListEntry;
}
