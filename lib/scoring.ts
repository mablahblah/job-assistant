import { Company, Job } from "./types";

export const SCORE_WEIGHTS = {
  employeeSatisfaction: 20,
  customerSatisfaction: 15,
  workLifeBalance: 30,
  politicalAlignment: 30,
  benefits: 25,
} as const;

// user's target annual salary — salary modifier centers on this value, needs to be in ##_### format.
export const TARGET_SALARY = 150_000;

// how much the modifier shifts per $25k away from target
const SALARY_STEP = 25_000;
const SALARY_STEP_SIZE = 0.1;

// multipliers for converting non-annual periods to yearly
const PERIOD_MULTIPLIERS: Record<string, number> = {
  hour: 2080, // 40 hrs/week × 52 weeks
  month: 12,
};

// parse a formatted salary string into annual min/max numbers
// handles: "$150-188k", "$120k+", "up to $200k", "$75/hour", "$75/hour-$100/hour"
export function parseSalaryRange(salary: string): {
  min?: number;
  max?: number;
} {
  if (!salary || salary === "?") return {};

  // detect period suffix like "/hour", "/month" for annualization
  const periodMatch = salary.match(/\/(\w+)/);
  const period = periodMatch?.[1]?.toLowerCase();
  const annualize = period ? (PERIOD_MULTIPLIERS[period] ?? null) : 1;

  // can't annualize unknown periods (e.g. "/week") — treat as unknown
  if (annualize === null) return {};

  // "$75/hour-$100/hour" or "$150-188k" range format
  const rangeMatch = salary.match(
    /\$([\d,]+)(?:k)?(?:\/\w+)?\s*[-–—]\s*\$?([\d,]+)(k)?/,
  );
  if (rangeMatch) {
    const raw1 = Number(rangeMatch[1].replace(/,/g, ""));
    const raw2 = Number(rangeMatch[2].replace(/,/g, ""));
    // "k" suffix means values are in thousands (e.g. "$150-188k")
    const multiplier = rangeMatch[3] ? 1000 : 1;
    return {
      min: raw1 * multiplier * annualize,
      max: raw2 * multiplier * annualize,
    };
  }

  // "up to $200k" or "up to $75/hour" — max only
  const upToMatch = salary.match(/up\s+to\s+\$([\d,]+)(k)?/);
  if (upToMatch) {
    const raw = Number(upToMatch[1].replace(/,/g, ""));
    const multiplier = upToMatch[2] ? 1000 : 1;
    return { max: raw * multiplier * annualize };
  }

  // "$120k+", "$75/hour+", or bare "$75/hour" / "$10000/month" — min only
  const minMatch = salary.match(/\$([\d,]+)(k)?(?:\+|\/\w+)/);
  if (minMatch) {
    const raw = Number(minMatch[1].replace(/,/g, ""));
    const multiplier = minMatch[2] ? 1000 : 1;
    return { min: raw * multiplier * annualize };
  }

  return {};
}

// salary modifier: 1.0 if target is in range, +/-0.1 per $25k gap
export function salaryModifier(salaryRange: string): number {
  const { min, max } = parseSalaryRange(salaryRange);

  // unknown salary — neutral
  if (min == null && max == null) return 1;

  // target falls within range — neutral
  if (
    min != null &&
    max != null &&
    min <= TARGET_SALARY &&
    max >= TARGET_SALARY
  )
    return 1;

  // range is entirely below target — penalize based on how far max is from target
  if (max != null && max < TARGET_SALARY) {
    const gap = TARGET_SALARY - max;
    return 1 - Math.floor(gap / SALARY_STEP) * SALARY_STEP_SIZE;
  }

  // range is entirely above target — boost based on how far min is from target
  if (min != null && min > TARGET_SALARY) {
    const gap = min - TARGET_SALARY;
    return 1 + Math.floor(gap / SALARY_STEP) * SALARY_STEP_SIZE;
  }

  // min-only or max-only where target is within the implied range — neutral
  return 1;
}

// full score if ≤3 days old, then decays 5%/day, floor 0.5
function ageModifier(postedAt: string | Date, now: Date): number {
  const posted = typeof postedAt === "string" ? new Date(postedAt) : postedAt;
  const daysOld = (now.getTime() - posted.getTime()) / (1000 * 60 * 60 * 24);

  if (daysOld <= 3) return 1;
  return Math.max(0.5, 1 - (daysOld - 3) * 0.05);
}

// score = category weights × age modifier × salary modifier, capped at 0–100
export function calculateScore(
  job: Job,
  company: Company,
  now: Date = new Date(),
): number {
  const categoryScore =
    ((company.employeeSatisfaction ?? 0) / 5) *
      SCORE_WEIGHTS.employeeSatisfaction +
    ((company.customerSatisfaction ?? 0) / 5) *
      SCORE_WEIGHTS.customerSatisfaction +
    ((company.workLifeBalance ?? 0) / 5) * SCORE_WEIGHTS.workLifeBalance +
    ((company.politicalAlignment ?? 0) / 5) * SCORE_WEIGHTS.politicalAlignment +
    ((company.benefits ?? 0) / 5) * SCORE_WEIGHTS.benefits;

  const adjusted =
    categoryScore *
    ageModifier(job.postedAt, now) *
    salaryModifier(job.salaryRange);
  return Math.round(Math.min(100, Math.max(0, adjusted)));
}
