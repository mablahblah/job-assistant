import { describe, expect, test } from "vitest";
import type { CompanyRecord } from "../services/company-service";
import type { JobRow } from "../types/job-row";
import { scoreReasoning } from "./score-reasoning";

function employer(): CompanyRecord {
  return {
    id: "company-1",
    name: "Acme",
    match_key: "acme",
    employee_satisfaction: null,
    customer_satisfaction: null,
    work_life_balance: null,
    political_alignment: null,
    employee_satisfaction_rationale: "People stay for years.",
    customer_satisfaction_rationale: "Customers renew.",
    work_life_balance_rationale: "No weekend work.",
    political_alignment_rationale: "Gives to both sides.",
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

// Criteria 157 and 158, as replaced on 2026-09-17. All five categories were
// tried first and judged by eye: 2,848 characters is more than a browser
// tooltip can show. Only the job's own reasoning is carried here now, and the
// employer's four wait for a hover panel that can hold them.
describe("scoreReasoning", () => {
  test("carries the job's own reasoning", () => {
    const row: JobRow = {
      job: { alignment_rationale: "A close match for the role." },
      company: employer(),
    };
    expect(scoreReasoning(row)).toBe("A close match for the role.");
  });

  test("carries no heading, because there is only one thing to head", () => {
    const row: JobRow = {
      job: { alignment_rationale: "A close match for the role." },
      company: null,
    };
    expect(scoreReasoning(row)).toBe("A close match for the role.");
  });

  test("leaves out the employer's reasoning entirely", () => {
    const row: JobRow = { job: { alignment_rationale: "A close match." }, company: employer() };
    const shown = scoreReasoning(row) ?? "";

    expect(shown).not.toContain("People stay for years.");
    expect(shown).not.toContain("Customers renew.");
    expect(shown).not.toContain("No weekend work.");
    expect(shown).not.toContain("Gives to both sides.");
  });

  test("treats reasoning that is only spaces as none at all", () => {
    expect(scoreReasoning({ job: { alignment_rationale: "   " }, company: employer() })).toBeNull();
  });

  // Criterion 160. Nothing to say means the total carries nothing to rest on,
  // rather than an empty tooltip that opens onto blank space.
  test("gives nothing where the job carries no reasoning", () => {
    expect(scoreReasoning({ job: {}, company: employer() })).toBeNull();
  });

  test("gives nothing for a job with no employer and no reasoning of its own", () => {
    expect(scoreReasoning({ job: {}, company: null })).toBeNull();
  });
});
