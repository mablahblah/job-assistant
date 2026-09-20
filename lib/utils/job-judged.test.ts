import { describe, expect, test } from "vitest";
import { isJobJudged } from "./job-judged";

// An employer with no score in any category, which each test fills in only
// as far as it needs.
const UNSCORED_EMPLOYER = {
  employee_satisfaction: null,
  customer_satisfaction: null,
  work_life_balance: null,
  political_alignment: null,
};

// Scoring's verdict on a job: judged once it holds a fit score, or once its
// employer holds any score at all. The employer counts even when the job's own
// score failed, because the scoring agent sometimes cannot open a posting.
describe("whether scoring has judged a job", () => {
  test("a job holding a fit score is judged", () => {
    expect(isJobJudged({ alignment_score: 3 }, null)).toBe(true);
  });

  test("a job with no fit score and no employer is not judged", () => {
    expect(isJobJudged({ alignment_score: null }, null)).toBe(false);
  });

  test("a job whose employer holds no score is not judged", () => {
    expect(isJobJudged({ alignment_score: null }, UNSCORED_EMPLOYER)).toBe(false);
  });

  test.each([
    "employee_satisfaction",
    "customer_satisfaction",
    "work_life_balance",
    "political_alignment",
  ] as const)("a job whose employer holds only %s is judged", (category) => {
    const employer = { ...UNSCORED_EMPLOYER, [category]: 2 };
    expect(isJobJudged({ alignment_score: null }, employer)).toBe(true);
  });

  // A score of zero is still a score, so the check asks whether one is there
  // rather than whether it is truthy.
  test("a fit score of zero still counts as a score", () => {
    expect(isJobJudged({ alignment_score: 0 }, null)).toBe(true);
  });
});
