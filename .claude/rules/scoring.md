# Scoring & Company Data Model Rules

## Null Scores
All 5 company scores (ES, CS, W/L, PA, Benefits) are nullable. Null displays as `"?"` in UI and is treated as `0` in the scoring formula so unscored companies sink to the bottom.

## Benefits on Company
Benefits is a company-level score, not per-job.

## Company Persistence
Company entries persist in DB even when no jobs reference them. Manual delete is available on the companies page.

## Scoring Formula
All scores 1–5, weighted formula capped at 0–100 with two multipliers (age + salary). Weights are relative — they don't need to sum to 100.

```
sum((score ?? 0) / 5 * weight) * ageModifier * salaryModifier
```
Rounded to nearest int, capped 0–100.

- **Age modifier:** 1.5× if <1 day old, 1.0× if 1–3 days, decays 0.05/day after day 3, floor 0.5×
- **Salary modifier:** ±0.1×/$25k from `TARGET_SALARY` (`lib/scoring.ts`); 1.0× when unknown; hourly ×2080, monthly ×12; no floor/ceiling

## Company Score Import Format
Claude returns a JSON array keyed by `company` (matches DB unique name). All 5 score fields per entry plus optional `note`. Import fully overwrites existing scores and note. Strip markdown fences before parsing.

Export copies prompt to clipboard (shows toast). Prompt pre-fills a JSON stub with exact DB company names to prevent name-match failures.

Company `note` stores Claude's scoring rationale and appears as a tooltip on the company name in both tables.
