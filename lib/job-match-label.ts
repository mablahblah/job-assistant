import type { JobDateFields } from "./job-dates";
import type { DedupeReason } from "./job-list-entry";

// The two dedupe reasons this file can produce, pulled from the shared
// vocabulary so the label and the trace row can never drift apart.
export type JobMatchLabel = Extract<
  DedupeReason,
  "hard_match_in_list" | "repost_match_in_list"
>;

const ONE_HOUR_IN_MS = 60 * 60 * 1000;

// How far apart two pooled dates have to be before they describe a real
// republication rather than two sources disagreeing about when one posting
// went live. It is a constant here rather than a setting because it
// describes source behaviour, not a judgement about the job — classification
// keeps its own tunable repost gap, and the two must move independently.
const REPOST_GAP_HOURS = 24;
const REPOST_GAP_IN_MS = REPOST_GAP_HOURS * ONE_HOUR_IN_MS;

// Names the kind of match behind a merged job's pooled dates: under 24 hours
// apart is a hard match, 24 hours or more is a repost match. The label picks
// a trace reason and nothing else — it sets no flag, writes no date, and
// leaves the job it read untouched.
//
// A job carrying one date, or none at all, has no gap to read and no
// evidence of republication, so it reads as a hard match.
export function matchLabel(job: JobDateFields): JobMatchLabel {
  const posted = job.posting_date;
  const updated = job.posting_updated_date;

  if (!posted || !updated) return "hard_match_in_list";

  const gapInMs = updated.getTime() - posted.getTime();
  return gapInMs >= REPOST_GAP_IN_MS ? "repost_match_in_list" : "hard_match_in_list";
}
