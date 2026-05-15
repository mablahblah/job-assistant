---
paths: ["lib/scoring.ts", "lib/scoring.test.ts", "scripts/cli.ts"]
---

# Scoring & Company Data Model Rules

## Dimensions
4 company-level scores (ES, CS, W/L, PA) + 1 job-level score (JA). All MUST be nullable, 1-5.

## Null Scores
Null MUST display as `"?"` and MUST be treated as `0` in the scoring formula so unscored items sink to bottom.

## Company Persistence
Company entries MUST persist in DB even when no jobs reference them. MUST NOT delete companies when their jobs are removed.

## Scoring Formula
All scores 1–5, weighted formula with two multipliers (age + salary). Weights are relative — no upper cap on the composite score.

```
(companyScore + jobScore) * ageModifier * salaryModifier
```

Where:
- companyScore = sum of (score/5 * weight) for ES(25), CS(10), W/L(25), PA(25)
- jobScore = (JA/5) * 15
- MUST round to nearest int, MUST cap 0–100

**Age modifier:** 1.2× if <1 day old, 1.0× if 1–3 days, decays 0.05/day after day 3, floor 0.5×

**Salary modifier:** ±0.1×/$25k from TARGET_SALARY ($150k); 1.0× when unknown; hourly ×2080, monthly ×12

## Job Alignment
MUST be scored per-job by Claude against the rubric in `.claude/skills/score-companies/job-alignment.md`. MUST be evaluated from scraped data only (title, company, location, salary) — MUST NOT fetch extra pages.

## Company Scoring
ES, CS, W/L, PA MUST be scored once per company via web research. `/score-companies` handles this. Existing scores MUST be trusted and skipped unless explicitly asked to re-score.
