// A job's total, worked out as the page is built rather than read from a
// stored column. An employer rescored after its jobs were saved moves all of
// them at once, which a stored number could not do.
import type { JobRow } from "../types/job-row";
import { YEARLY_MULTIPLIERS } from "./salary-periods";

// What each of the five categories is worth when it scores five out of five.
// Together they come to 125, which is the sum before the age and pay parts
// multiply it.
const SCORE_WEIGHTS = {
  employeeSatisfaction: 25,
  customerSatisfaction: 10,
  workLifeBalance: 25,
  politicalAlignment: 25,
  jobAlignment: 40,
} as const;

const RATING_SCALE = 5;

// A category nobody has judged is the ordinary state of a freshly collected
// job, because scoring runs after the pipeline. Counting it as nothing would
// bury every new job under the ones an agent has already got to, so it counts
// as the middle of the scale instead — neither a mark for nor against.
const NEUTRAL_RATING = 3;

const TARGET_SALARY = 150_000;
const SALARY_STEP = 25_000;
const SALARY_STEP_SIZE = 0.1;

function ratingOrMiddle(value: number | null | undefined): number {
  return value ?? NEUTRAL_RATING;
}

// Fresh today, level for the first three days, then a twentieth off a day
// until it reaches half and stops. An old posting still open is still a real
// opening, so it never falls further than that.
//
// The first posting date is what is read, never the updated one. An updated
// date says the posting changed, not that the role went live then, so aging a
// job posted again from it would make an old role look new.
function agePart(postingDate: Date | null | undefined, now: Date): number {
  if (postingDate == null) return 1;
  const daysOld = (now.getTime() - postingDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysOld < 1) return 1.2;
  if (daysOld <= 3) return 1;
  return Math.max(0.5, 1 - (daysOld - 3) * 0.05);
}

function stepsFromTarget(figure: number): number {
  return Math.floor(Math.abs(figure - TARGET_SALARY) / SALARY_STEP) * SALARY_STEP_SIZE;
}

function payPart(
  salaryLow: number | null | undefined,
  salaryHigh: number | null | undefined,
  salaryPeriod: string | null | undefined
): number {
  // A period outside the five is evidence the figures are not yearly, not an
  // invitation to assume they are. Reading "5,000 per project" as a 5,000
  // salary would halve the total on a job nobody could judge.
  const perYear = salaryPeriod == null ? undefined : YEARLY_MULTIPLIERS[salaryPeriod];
  if (perYear == null) return 1;

  const low = salaryLow == null ? null : salaryLow * perYear;
  const high = salaryHigh == null ? null : salaryHigh * perYear;

  if (low != null && high != null) {
    if (low <= TARGET_SALARY && high >= TARGET_SALARY) return 1;
    if (high < TARGET_SALARY) return 1 - stepsFromTarget(high);
    return 1 + stepsFromTarget(low);
  }

  // One figure, or neither. A lone figure carries no evidence of which end of
  // a band it was, so it is read as a plain number rather than guessed at.
  const lone = low ?? high;
  if (lone == null) return 1;
  if (lone < TARGET_SALARY) return 1 - stepsFromTarget(lone);
  if (lone > TARGET_SALARY) return 1 + stepsFromTarget(lone);
  return 1;
}

export function scoreTotal(row: JobRow, now: Date = new Date()): number {
  const { job, company } = row;

  const weightedSum =
    (ratingOrMiddle(company?.employee_satisfaction) / RATING_SCALE) *
      SCORE_WEIGHTS.employeeSatisfaction +
    (ratingOrMiddle(company?.customer_satisfaction) / RATING_SCALE) *
      SCORE_WEIGHTS.customerSatisfaction +
    (ratingOrMiddle(company?.work_life_balance) / RATING_SCALE) * SCORE_WEIGHTS.workLifeBalance +
    (ratingOrMiddle(company?.political_alignment) / RATING_SCALE) *
      SCORE_WEIGHTS.politicalAlignment +
    (ratingOrMiddle(job.alignment_score) / RATING_SCALE) * SCORE_WEIGHTS.jobAlignment;

  return Math.round(weightedSum * agePart(job.posting_date, now) * payPart(job.salary_low, job.salary_high, job.salary_period));
}
