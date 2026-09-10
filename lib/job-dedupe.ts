import type { JobListEntry } from "./job-list-entry";
import { matchingClause, type JobIdentityClause } from "./job-identity";
import { matchLabel } from "./job-match-label";
import { mergeJobs, pickWinner } from "./job-merge";

// One edge of the fold: the entry that left the list, the entry it merged into
// at that moment, and the identity clause that tied the two together. Kept per
// edge rather than per final survivor, because a chain of three folded in two
// steps draws as two hops and naming the last survivor would lose the middle.
export interface JobFold {
  loser: JobListEntry;
  becameId: string | undefined;
  clause: JobIdentityClause;
}

export interface FoldMatchingJobsResult {
  jobs: JobListEntry[];
  folds: JobFold[];
}

// The first survivor an entry is the same job as, and the clause that says so.
// Asked once per pair: the identity rules already try every clause in order and
// name the first that fires, so the fold never looks for a second one itself.
function firstMatch(
  survivors: readonly JobListEntry[],
  entry: JobListEntry
): { index: number; clause: JobIdentityClause } | null {
  for (let index = 0; index < survivors.length; index += 1) {
    const clause = matchingClause(survivors[index], entry);
    if (clause !== null) return { index, clause };
  }
  return null;
}

// Collapses every run of entries the identity rules call the same job into a
// single entry. Matching chains: A folds into B, and the merged entry may then
// match C even where A and C never matched each other, because the merge pools
// both sides' dates and links.
//
// Each entry is carried against the survivors gathered so far and folded into
// every one it matches, the merged entry taking its place each time, until
// nothing matches and it joins the survivors itself. That collapses a chain
// and joins two groups an entry sits between, at one scan of the survivors per
// entry rather than a fresh sweep of every pair after every fold.
export function foldMatchingJobs(
  jobs: readonly JobListEntry[],
  priorityList: readonly string[],
  collectedAt: Date
): FoldMatchingJobsResult {
  // Built fresh, so nothing the caller handed in is written to.
  const survivors: JobListEntry[] = [];
  const folds: JobFold[] = [];

  for (const job of jobs) {
    let carried = job;

    for (let match = firstMatch(survivors, carried); match !== null; ) {
      const earlier = survivors[match.index];

      // The shared merge rule settles every field and pools both dates.
      // Position decides only the tie-break and whose collection date rides.
      const merged = mergeJobs(earlier, carried, priorityList, collectedAt);

      // The merged entry carries the id survivor's id, so the other side is
      // the one that has to leave. Whose data won the contest is a separate
      // question and routinely lands on the opposite side, because a side
      // holding a database row keeps its id however its data ranked.
      const { idSurvivor } = pickWinner(earlier, carried, priorityList);
      const loser = idSurvivor === earlier ? carried : earlier;

      // The reason it lost reads off the merged entry's pooled dates rather
      // than either side's own, and is set on a copy so the input stays clean.
      folds.push({
        loser: { ...loser, delete_on_save: matchLabel(merged) },
        becameId: merged.id,
        clause: match.clause,
      });

      // The survivor it folded into leaves the list, and the wider merged
      // entry is what goes looking for the next match.
      survivors.splice(match.index, 1);
      carried = merged;
      match = firstMatch(survivors, carried);
    }

    survivors.push(carried);
  }

  return { jobs: survivors, folds };
}
