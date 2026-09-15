import { describe, expect, test } from "vitest";
import { cleanBacklogCompanies } from "./backlog-cleanup";
import type { CompanyRecord } from "../services/company-service";
import { unscoredCompany } from "../services/company-service.fake";

// Every company here is judged against one instant, the way a run judges
// every job against the moment it started.
const NOW = new Date("2026-09-15T00:00:00.000Z");
const SCORE_EXPIRY_DAYS = 90;
const GUESSED_SCORE_EXPIRY_DAYS = 30;

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

function scoredCompany(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return unscoredCompany({
    id: "c1",
    name: "Scored Co",
    match_key: "scoredco",
    employee_satisfaction: 4,
    customer_satisfaction: 3,
    work_life_balance: 5,
    political_alignment: 2,
    employee_satisfaction_rationale: "well reviewed",
    customer_satisfaction_rationale: "nothing public",
    work_life_balance_rationale: "respects time",
    political_alignment_rationale: "mixed record",
    scored_at: daysBefore(1),
    ...overrides,
  });
}

async function clean(company: CompanyRecord): Promise<CompanyRecord> {
  const result = await cleanBacklogCompanies([company], {
    scoreExpiryDays: SCORE_EXPIRY_DAYS,
    guessedScoreExpiryDays: GUESSED_SCORE_EXPIRY_DAYS,
    referenceInstant: NOW,
  });
  const [cleaned] = result.companies;
  if (!cleaned) throw new Error("the handler returned no company");
  return cleaned;
}

// Criteria 31 to 34. A judgement about an employer ages, and a stale one would
// rank a job against a company that has since changed.
describe("a company scored longer ago than the score expiry", () => {
  const stale = () => scoredCompany({ scored_at: daysBefore(91) });

  test("all four of its category scores are emptied", async () => {
    const cleaned = await clean(stale());

    expect(cleaned.employee_satisfaction).toBeNull();
    expect(cleaned.customer_satisfaction).toBeNull();
    expect(cleaned.work_life_balance).toBeNull();
    expect(cleaned.political_alignment).toBeNull();
  });

  test("the reasoning behind all four is emptied", async () => {
    const cleaned = await clean(stale());

    expect(cleaned.employee_satisfaction_rationale).toBeNull();
    expect(cleaned.customer_satisfaction_rationale).toBeNull();
    expect(cleaned.work_life_balance_rationale).toBeNull();
    expect(cleaned.political_alignment_rationale).toBeNull();
  });

  test("its guessed list is emptied", async () => {
    const cleaned = await clean(
      scoredCompany({ scored_at: daysBefore(91), scores_guessed: ["customer_satisfaction"] })
    );

    expect(cleaned.scores_guessed).toEqual([]);
  });

  test("the date it was scored is emptied", async () => {
    const cleaned = await clean(stale());

    expect(cleaned.scored_at).toBeNull();
  });

  test("it is counted as having lost its scores", async () => {
    const result = await cleanBacklogCompanies([stale()], {
      scoreExpiryDays: SCORE_EXPIRY_DAYS,
      guessedScoreExpiryDays: GUESSED_SCORE_EXPIRY_DAYS,
      referenceInstant: NOW,
    });

    expect(result.scoresCleared).toBe(1);
  });
});

// Criterion 38. The threshold helper is inclusive by documented intent, and
// the job half of this handler reads it the same way.
describe("a company scored exactly as long ago as the score expiry", () => {
  test("its scores are emptied", async () => {
    const cleaned = await clean(scoredCompany({ scored_at: daysBefore(90) }));

    expect(cleaned.employee_satisfaction).toBeNull();
  });
});

// Criteria 35 to 37. A 3 the agent guessed at is a placeholder rather than
// research, so it stands for less time than a real judgement.
describe("a company past the guessed-score expiry and within the score expiry", () => {
  const partlyGuessed = () =>
    scoredCompany({
      scored_at: daysBefore(31),
      scores_guessed: ["customer_satisfaction"],
    });

  test("only the guessed category is emptied", async () => {
    const cleaned = await clean(partlyGuessed());

    expect(cleaned.customer_satisfaction).toBeNull();
    expect(cleaned.customer_satisfaction_rationale).toBeNull();
  });

  test("the categories that were researched keep the values they had", async () => {
    const cleaned = await clean(partlyGuessed());

    expect(cleaned.employee_satisfaction).toBe(4);
    expect(cleaned.work_life_balance).toBe(5);
    expect(cleaned.political_alignment).toBe(2);
  });

  test("the emptied category is removed from its guessed list", async () => {
    const cleaned = await clean(partlyGuessed());

    expect(cleaned.scores_guessed).toEqual([]);
  });

  // The date stays, because the researched categories are still as old as it
  // says they are.
  test("the date it was scored is kept", async () => {
    const cleaned = await clean(partlyGuessed());

    expect(cleaned.scored_at).not.toBeNull();
  });

  test("it is counted as having lost only its guesses", async () => {
    const result = await cleanBacklogCompanies([partlyGuessed()], {
      scoreExpiryDays: SCORE_EXPIRY_DAYS,
      guessedScoreExpiryDays: GUESSED_SCORE_EXPIRY_DAYS,
      referenceInstant: NOW,
    });

    expect(result.guessesCleared).toBe(1);
    expect(result.scoresCleared).toBe(0);
  });
});

// A company past both expiries at the same moment loses everything, not only
// the categories it guessed at.
describe("a company past both expiries at once", () => {
  test("everything is emptied", async () => {
    const cleaned = await clean(
      scoredCompany({ scored_at: daysBefore(200), scores_guessed: ["customer_satisfaction"] })
    );

    expect(cleaned.employee_satisfaction).toBeNull();
    expect(cleaned.scored_at).toBeNull();
  });
});

describe("a company whose scores are still fresh", () => {
  test("nothing is emptied", async () => {
    const cleaned = await clean(scoredCompany({ scored_at: daysBefore(2) }));

    expect(cleaned.employee_satisfaction).toBe(4);
    expect(cleaned.scored_at).not.toBeNull();
  });

  // A guess inside its own expiry stands, because it is still the best
  // answer anyone has.
  test("a guess inside the guessed-score expiry stands", async () => {
    const cleaned = await clean(
      scoredCompany({ scored_at: daysBefore(5), scores_guessed: ["customer_satisfaction"] })
    );

    expect(cleaned.customer_satisfaction).toBe(3);
    expect(cleaned.scores_guessed).toEqual(["customer_satisfaction"]);
  });
});

describe("a company nothing has scored yet", () => {
  test("it is left exactly as it was", async () => {
    const cleaned = await clean(unscoredCompany({ id: "c9", name: "Never Scored Co" }));

    expect(cleaned.scored_at).toBeNull();
    expect(cleaned.employee_satisfaction).toBeNull();
  });
});

// Criteria 64 and 64a. A handler acts on every entry in the list it is handed
// and hands that list back.
describe("the shape the handler returns", () => {
  test("returns a list the same length as the one handed in", async () => {
    const result = await cleanBacklogCompanies(
      [scoredCompany({ id: "a" }), scoredCompany({ id: "b" }), scoredCompany({ id: "c" })],
      {
        scoreExpiryDays: SCORE_EXPIRY_DAYS,
        guessedScoreExpiryDays: GUESSED_SCORE_EXPIRY_DAYS,
        referenceInstant: NOW,
      }
    );

    expect(result.companies).toHaveLength(3);
  });

  test("every entry is acted on, not only the first", async () => {
    const result = await cleanBacklogCompanies(
      [
        scoredCompany({ id: "a", scored_at: daysBefore(91) }),
        scoredCompany({ id: "b", scored_at: daysBefore(91) }),
      ],
      {
        scoreExpiryDays: SCORE_EXPIRY_DAYS,
        guessedScoreExpiryDays: GUESSED_SCORE_EXPIRY_DAYS,
        referenceInstant: NOW,
      }
    );

    expect(result.companies.map((company) => company.employee_satisfaction)).toEqual([null, null]);
  });

  // The company handed in is never touched, so a caller's own list still
  // holds what it held.
  test("the company handed in is left alone", async () => {
    const company = scoredCompany({ scored_at: daysBefore(91) });

    await clean(company);

    expect(company.employee_satisfaction).toBe(4);
  });

  test("an empty list comes back empty", async () => {
    const result = await cleanBacklogCompanies([], {
      scoreExpiryDays: SCORE_EXPIRY_DAYS,
      guessedScoreExpiryDays: GUESSED_SCORE_EXPIRY_DAYS,
      referenceInstant: NOW,
    });

    expect(result.companies).toEqual([]);
  });
});
