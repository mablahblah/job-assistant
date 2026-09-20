// Whether scoring has judged a job. A fit score on the job is the plain case.
// An employer holding any score counts too, even when the job's own score
// failed, because the scoring agent sometimes cannot open a posting and the
// job has still been looked at through its employer.
//
// The three pipeline markers are deliberately absent here. Scoring only ever
// sees jobs from findNeedingScores, which already requires the link followed,
// the posting read and the location checked, so a job reaching this rule has
// passed all three. The one-time fill in the add_is_judged migration spells
// those three out because it runs against every stored row, not against that
// list.
import { SCORE_CATEGORIES, type CompanyRecord, type ScoreCategory } from "../services/company-service";
import type { JobListEntry } from "../types/job-list-entry";

export function isJobJudged(
  job: Pick<JobListEntry, "alignment_score">,
  employer: Pick<CompanyRecord, ScoreCategory> | null
): boolean {
  if (job.alignment_score != null) return true;
  if (employer === null) return false;
  return SCORE_CATEGORIES.some((category) => employer[category] != null);
}
