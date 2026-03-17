import { Company, Job } from './types'

/**
 * Weights for each scoring category.
 * Values represent the max points each category contributes to the total score.
 * Total of all weights = 100.
 */
export const SCORE_WEIGHTS = {
  employeeSatisfaction: 25,
  customerSatisfaction: 15,
  workLifeBalance: 30,
  politicalAlignment: 10,
  benefits: 20,
} as const

/**
 * Posting age modifier: full score if ≤3 days old, then decays.
 * Floor at 0.5 (posts never lose more than half their score from age).
 */
function ageModifier(postedAt: string, now: Date): number {
  const posted = new Date(postedAt)
  const daysOld = (now.getTime() - posted.getTime()) / (1000 * 60 * 60 * 24)

  if (daysOld <= 3) return 1
  return Math.max(0.5, 1 - (daysOld - 3) * 0.05)
}

/**
 * Calculate a job's overall score (0–100).
 *
 * Each 1–5 category score is normalized to 0–1, multiplied by its weight,
 * then the total is adjusted by the posting age modifier.
 */
export function calculateScore(
  job: Job,
  company: Company,
  now: Date = new Date()
): number {
  const categoryScore =
    (company.employeeSatisfaction / 5) * SCORE_WEIGHTS.employeeSatisfaction +
    (company.customerSatisfaction / 5) * SCORE_WEIGHTS.customerSatisfaction +
    (company.workLifeBalance / 5) * SCORE_WEIGHTS.workLifeBalance +
    (company.politicalAlignment / 5) * SCORE_WEIGHTS.politicalAlignment +
    (job.benefits / 5) * SCORE_WEIGHTS.benefits

  const adjusted = categoryScore * ageModifier(job.postedAt, now)
  return Math.round(Math.min(100, Math.max(0, adjusted)))
}
