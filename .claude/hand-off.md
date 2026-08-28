# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Decisions & Context** section for reasoning that isn't captured elsewhere.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

Feature: **Unified Job Pipeline** — fourteen phases on the long-lived branch `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 1 (Collection) is building. Tasks 1 through 11 are done; five remain.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **task 12, renaming the raw fields**.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md`. Read it with `phase-01-collection-r&d.md` beside it. It keeps **two parallel numbered lists** — User Stories 1–78 and Acceptance Criteria 1–102. A reference like "AC 33" always means the criteria list. Confusing the two is how four stale criteria once survived an audit.

Code is committed and pushed through `0868494`. **Two doc files are modified and uncommitted:** the tick on task 11 in `docs/CURRENT-FEATURE.md`, and one new entry at the end of `docs/features/unified-pipeline/decision-log.md`.

## Completed This Session

**Task 11 — Adzuna's predicted salaries are no longer collected.** `salary_is_predicted` was added to the `AdzunaJob` type and the `normalizeSalary` spread is gated on it being exactly `"0"`. Ten tests were added across three describes: AC 99, AC 98, and the case where the flag is absent entirely, which neither criterion names.

**Verified:** `npm run test` exit 0 with 786 passing across 29 files, up from 776. `npx tsc --noEmit` exit 0. `npm run lint` exit 0. The guard was then flipped to `!== "1"` to confirm the absent-flag tests fail — 4 failed, 45 passed — and restored, so the tests are load-bearing.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. One was added this session, on Adzuna's search filter.

**Measured facts carried forward, taken live on 2026-08-28:**

- **Adzuna predicts most of its salaries.** 133 of 150 live results carried `salary_is_predicted: "1"`. Those come from Adzuna's model, not the posting, and usually arrive with low equal to high.
- **Greenhouse entity-encodes its HTML exactly once**, and handling that properly took the description salary count from 302 to 787.
- **linkedom returns an empty body for a bare fragment.** `parseHTML` must get a full `<html><body>…</body></html>`.
- **Every source that publishes a salary publishes numbers.** Adzuna dollars, JSearch numbers plus a period word, Greenhouse **cents**, Ashby whole dollars under `compensation.summaryComponents` with equity in the same array. Lever publishes none.
- **Ashby's and Lever's board endpoints carry no employer name.**
- **A thousands group holds exactly three digits.** Intercom published `$118,00`; reading it files a $118,000 job as $11,800.

**Constraints and gotchas:**

- **An absent `salary_is_predicted` is treated as not-published.** Only an explicit `"0"` lets a salary through. This is deliberate and directly tested.
- **AC 98–99 are written against `raw_salary`, which does not exist yet.** Task 12 does that rename. The criteria are met in substance under today's `salary_raw`.
- **`crowd-code-writer` agents have Read, Grep and Glob only — no shell.** The working pattern is snippet-sized briefs: ask for a snippet, run it yourself, send it back if it needs work. Briefs of that size returned in 30–110 seconds.
- **Their output arrives with HTML-escaped arrows** — `=&gt;` instead of `=>`. It came back that way from both agents on both rounds. Unescape before applying.
- **They restate a whole fixture to change one field.** Pointing them at the file's own spread idiom fixed it in one pass.
- **A heredoc'd Python `'''…'''` block eats backslash escapes.** `\"` inside one produced a broken `describe` title that `tsc` and vitest both caught. Use a different quoting strategy when applying test code.
- **The commit hook flags `toJobListEntry` as untested.** It is not exported, so the graph cannot see the 49 tests reaching it through `adzunaCollector.collect`. False positive.

**Open questions, all recorded in their phase r&d files:**

- Whether Association's two passes differ, and what a normalized-name match actually compares (Phase 4)
- Whether JSearch's employer name should be trusted for a match — it holds the publishing job board 4 times in 10 (Phase 4)
- Whether a slug match should correct a company's stale seeded name (Phase 4)
- What normalizing a title actually does — the research is in `feature_r&d.md` and has never become a spec (Phase 3)

## Next Steps

1. **Commit the two modified doc files.** The task 11 tick and the decision-log entry.
2. **Task 12 — rename the raw fields.** `original_title` → `raw_title`, `original_location_list` → `raw_location_list`, `original_mode_list` → `raw_mode_list`, `company_name` → `raw_company_name`, `salary_raw` → `raw_salary` as a `Json` column. Add `raw_company_slug`. `description` keeps its name. Every collector writes `raw_salary` instead of a low, a high and a period. The docs already describe this target state; the schema and code are what lag. Run `npx prisma generate` after editing the schema. — AC 80–81, 84
3. **Task 13 — take parsing and name shaping out of the collectors.** Revert the `db07e3d` wiring, stop Lever fetching its board page for a name, and stop `nameFromBoardTitle` and `nameFromSlug` running at collection. The utils and fixture stay for Phase 8. — AC 100–102
4. **Task 14 — build the Ashby collector.** Last, deliberately, so it is built once against rules that have stopped moving. `isListed` filter, `raw_company_slug` only, and the salary is the `summaryComponents` entry whose `compensationType` is `"Salary"` — not the first entry, which is equity.
5. **Task 15 — wire the `job-search` skill.** One step that runs the orchestrator and surfaces errors and warnings first.
6. **Task 16 — live one-job command.** Outside the default suite, no fixture written.
7. Then **Plan phase 2 — Tracing**, following the phase planning procedure.
