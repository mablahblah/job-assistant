import { describe, expect, test } from "vitest";
import type { CompanyRecord } from "../services/company-service";
import type { JobRow } from "../types/job-row";
import { scoreTotal } from "./score-total";

// The moment every test reads as now, so nothing depends on the clock the
// suite happens to run under.
const NOW = new Date("2026-04-20T12:00:00Z");

// Two days before now. Old enough that the age part is neutral, young enough
// that nothing has decayed, so a test about pay is only about pay.
const NEUTRAL_POSTING = new Date("2026-04-18T12:00:00Z");

// Every rating at four out of five gives a weighted sum of exactly 100, so a
// part that raises or lowers the total is read straight off the number.
function employerRatedFour(): CompanyRecord {
  return {
    id: "company-1",
    name: "Acme",
    match_key: "acme",
    employee_satisfaction: 4,
    customer_satisfaction: 4,
    work_life_balance: 4,
    political_alignment: 4,
    employee_satisfaction_rationale: null,
    customer_satisfaction_rationale: null,
    work_life_balance_rationale: null,
    political_alignment_rationale: null,
    scored_at: null,
    scores_guessed: [],
    address: null,
    phone: null,
    website: null,
    enriched_at: null,
    enrichment_status: null,
    enrichment_uncertain: false,
    enrichment_flags: [],
  };
}

function employerRatedNothing(): CompanyRecord {
  return {
    ...employerRatedFour(),
    employee_satisfaction: null,
    customer_satisfaction: null,
    work_life_balance: null,
    political_alignment: null,
  };
}

function rowRatedFour(job: JobRow["job"] = {}): JobRow {
  return {
    job: { alignment_score: 4, posting_date: NEUTRAL_POSTING, ...job },
    company: employerRatedFour(),
  };
}

// The weighted sum: employee satisfaction 25, customer satisfaction 10,
// work-life balance 25, political alignment 25, and the job's own alignment 40.
describe("the weighted sum", () => {
  test("every rating at four out of five totals 100", () => {
    expect(scoreTotal(rowRatedFour(), NOW)).toBe(100);
  });

  test("every rating at five out of five totals 125", () => {
    const row = rowRatedFour({ alignment_score: 5 });
    row.company = { ...employerRatedFour(), employee_satisfaction: 5, customer_satisfaction: 5, work_life_balance: 5, political_alignment: 5 };
    expect(scoreTotal(row, NOW)).toBe(125);
  });
});

// Criterion 147, and criterion 148 for the case where there is no employer at
// all. An unscored category is the ordinary state of a freshly collected job,
// so counting it as nothing would bury every new job at the bottom of the list.
describe("a rating nobody gave", () => {
  test("counts as three out of five", () => {
    const row: JobRow = { job: { alignment_score: 4, posting_date: NEUTRAL_POSTING }, company: employerRatedNothing() };
    expect(scoreTotal(row, NOW)).toBe(83);
  });

  test("a job linked to no employer counts all four employer categories as the middle", () => {
    const row: JobRow = { job: { alignment_score: 4, posting_date: NEUTRAL_POSTING }, company: null };
    expect(scoreTotal(row, NOW)).toBe(83);
  });

  test("a job never scored counts its own category as the middle too", () => {
    const row: JobRow = { job: { posting_date: NEUTRAL_POSTING }, company: employerRatedNothing() };
    expect(scoreTotal(row, NOW)).toBe(75);
  });
});

// Criteria 149 to 155. The target is 150,000 a year, and the pay part moves a
// tenth for every 25,000 of gap.
describe("the pay part", () => {
  test("a band holding the target leaves the total alone", () => {
    const row = rowRatedFour({ salary_low: 120_000, salary_high: 180_000, salary_period: "year" });
    expect(scoreTotal(row, NOW)).toBe(100);
  });

  test("a band below the target lowers the total, measured from its high figure", () => {
    const row = rowRatedFour({ salary_low: 80_000, salary_high: 100_000, salary_period: "year" });
    expect(scoreTotal(row, NOW)).toBe(80);
  });

  test("a band above the target raises the total, measured from its low figure", () => {
    const row = rowRatedFour({ salary_low: 200_000, salary_high: 250_000, salary_period: "year" });
    expect(scoreTotal(row, NOW)).toBe(120);
  });

  // Criterion 152. A lone figure carries no evidence of which end of a band it
  // was, so it is read as a plain number rather than guessed at.
  test("a lone low figure is compared to the target directly", () => {
    const row = rowRatedFour({ salary_low: 100_000, salary_period: "year" });
    expect(scoreTotal(row, NOW)).toBe(80);
  });

  test("a lone high figure is compared to the target directly", () => {
    const row = rowRatedFour({ salary_high: 200_000, salary_period: "year" });
    expect(scoreTotal(row, NOW)).toBe(120);
  });

  test("no figures at all leaves the total alone", () => {
    const row = rowRatedFour({ salary_period: "year" });
    expect(scoreTotal(row, NOW)).toBe(100);
  });

  // Criterion 155. An empty period means the source used a word outside the
  // five the pipeline reads, which is evidence the figure is not yearly.
  // Reading it as yearly would turn "5,000 per project" into a 5,000 salary.
  test("figures with no readable period leave the total alone", () => {
    const row = rowRatedFour({ salary_low: 5_000, salary_high: 5_000 });
    expect(scoreTotal(row, NOW)).toBe(100);
  });
});

// Criterion 154. Each of these five figures is the same 249,600 a year once
// converted, which is 99,600 above the target — three whole steps, so each
// raises the total by three tenths.
describe("every period converts to a year", () => {
  test.each([
    ["hour", 120],
    ["day", 960],
    ["week", 4_800],
    ["month", 20_800],
    ["year", 249_600],
  ])("a figure published by the %s", (period, figure) => {
    const row = rowRatedFour({ salary_low: figure, salary_period: period });
    expect(scoreTotal(row, NOW)).toBe(130);
  });
});

// The age part: fresh today, neutral for one to three days, then decaying a
// twentieth a day and stopping at half.
describe("the age part", () => {
  test("a job posted today raises the total", () => {
    const row = rowRatedFour({ posting_date: new Date("2026-04-20T06:00:00Z") });
    expect(scoreTotal(row, NOW)).toBe(120);
  });

  test("a job posted ten days ago has decayed", () => {
    const row = rowRatedFour({ posting_date: new Date("2026-04-10T12:00:00Z") });
    expect(scoreTotal(row, NOW)).toBe(65);
  });

  test("decay stops at half however old the job is", () => {
    const row = rowRatedFour({ posting_date: new Date("2025-04-20T12:00:00Z") });
    expect(scoreTotal(row, NOW)).toBe(50);
  });

  // A job whose source published no date at all. Neutral rather than treated
  // as ancient, which is how an unknown pay figure is treated too.
  test("a job with no posting date leaves the total alone", () => {
    const row = rowRatedFour({ posting_date: null });
    expect(scoreTotal(row, NOW)).toBe(100);
  });

  // Criterion 156. The later date says the posting changed, not that the role
  // first went live then.
  test("a job posted again is still aged from when it first went live", () => {
    const row = rowRatedFour({
      is_repost: true,
      posting_updated_date: new Date("2026-04-20T06:00:00Z"),
    });
    expect(scoreTotal(row, NOW)).toBe(100);
  });
});
