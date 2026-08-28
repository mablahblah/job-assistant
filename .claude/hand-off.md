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

Feature: **Unified Job Pipeline** — one feature, now **fourteen** phases, on the long-lived branch `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 1 (Collection) is building. Tasks 1 through 10 are done; six remain, renumbered and resequenced this session.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **task 11, dropping Adzuna's predicted salaries**.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md`. Read it with `phase-01-collection-r&d.md` beside it. Note it keeps **two parallel numbered lists** — User Stories 1–78 and Acceptance Criteria 1–102. A reference like "AC 33" always means the criteria list. Confusing the two is how four stale criteria survived an audit this session.

Working tree is clean. Everything is committed and pushed, through `df4ec10`.

## Completed This Session

**Task 15 was built, then moved to Phase 8 before it shipped.** Three shared utils — `descriptionToText`, `readSalaryFromText`, `readWorkModeFromText` — plus a committed fixture of 178 real excerpts at `lib/description-fields.fixture.json`. Measured across all 4,661 live descriptions: 787 salaries and 1,956 work modes read, no implausible result, and no disagreement with Lever's own published field. Every guard was broken afterwards to prove a test caught it; one survived and got a test.

Greenhouse and Lever are wired to them in `db07e3d`, which is a **clean revert target** — task 13 takes that wiring back out.

**The bigger work was architectural.** The line between phases was blurry, so `feature_spec.md` gained a rubric, **What Each Step Owns**, with one test settling the blurriest pair: *normalizing reshapes a value that exists, parsing produces one that does not.*

**Company Association became Phase 4**, between Normalization and DB Save. Phases 4 through 12 shifted up by one; nine files were renamed and ~71 references updated.

**Phase 1's criteria were audited and corrected**, then two agents audited every r&d file against the rubric. Their findings are applied.

**Verified:** `npm run test` exit 0 with 776 passing across 29 files, `npx tsc --noEmit` exit 0, `npm run lint` exit 0.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. Eighteen were added or replaced this session.

**Measured facts, all taken live on 2026-08-28:**

- **Greenhouse entity-encodes its HTML exactly once.** One decode returns real markup; parsing that markup then resolves `&mdash;`. Handling this properly took the salary count from **302 to 787** — the naive version was mangling the markup and hiding more than half.
- **linkedom returns an empty body for a bare fragment.** `parseHTML` must get a full `<html><body>…</body></html>`.
- **Block tags need a space after them.** Text alone runs one block into the next, so `team</p><p>This role is remote` arrives as `teamThis` and the sentence is lost. Inline tags get none, keeping `<span>$139,200</span><span>—</span>` one figure.
- **Adzuna predicts most of its salaries.** 133 of 150 live results carried `salary_is_predicted: "1"`. Those come from Adzuna's model, not the posting, and usually arrive with low equal to high.
- **Every source that publishes a salary publishes numbers.** Adzuna dollars, JSearch numbers plus a period word, Greenhouse **cents**, Ashby whole dollars nested under `compensation.summaryComponents` with equity in the same array. Lever publishes none. A range as a string only ever appears in description prose.
- **Ashby's board endpoint carries no employer name** — only `jobs` and `apiVersion`. Lever's carries none either.
- **A thousands group holds exactly three digits.** Intercom published `$118,00`, a digit short; reading it files a $118,000 job as $11,800.
- **The word "remote" appears in 1,649 of 4,661 descriptions**, almost always as company talk. Only a deliberate hashtag or a role-anchored phrase is read.
- **"hybrid" often means blended duties**, not a place. `This role is a hybrid mix of program management` matches the same shape as a real mode statement.

**Process gotchas worth not rediscovering:**

- **`crowd-code-writer` agents have Read, Grep and Glob only — no shell.** A brief asking one to run `vitest` and iterate until green is impossible to satisfy. Two agents ground for 27 minutes on exactly that before dying on a session limit. The working pattern is the one the user named: ask for a snippet, run it yourself, send it back if it needs work. Snippet-sized briefs came back in 40–60 seconds.
- **The Phase 1 spec has two parallel numbered lists.** Described above; it cost a real error.

**Approaches tried and dropped:**

- **Description-mining in Phase 3.** Placed there first, following the user's own flow, then moved to Phase 8 once the rubric made the line explicit: an empty field needs someone to go looking, and that is parsing.
- **Deslugifying inside Normalization.** Dropped because nothing downstream can tell `gohighlevel` from a single-word employer. The slug travels as its own field instead.
- **Folding Company Association into DB Save.** DB Save already scoped company match-or-create, so this was the zero-churn option. Rejected because burying a distinct pipeline step inside "save" hides it.

**Open questions, all recorded in their phase r&d files:**

- Whether Association's two passes differ, and what a normalized-name match actually compares (Phase 4)
- Whether JSearch's employer name should be trusted for a match — it holds the publishing job board 4 times in 10 (Phase 4)
- Whether a slug match should correct a company's stale seeded name (Phase 4)
- What normalizing a title actually does — the research is in `feature_r&d.md` and has never become a spec (Phase 3)

## Next Steps

1. **Task 11 — drop Adzuna's predicted salaries.** Read the salary only where `salary_is_predicted` is `"0"`. — AC 98–99
2. **Task 12 — rename the raw fields.** `original_title` → `raw_title`, `original_location_list` → `raw_location_list`, `original_mode_list` → `raw_mode_list`, `company_name` → `raw_company_name`, `salary_raw` → `raw_salary` as a `Json` column. Add `raw_company_slug`. `description` keeps its name. Every collector writes `raw_salary` instead of a low, a high and a period. The docs already describe this target state; the schema and code are what lag. — AC 80–81, 84
3. **Task 13 — take parsing and name shaping out of the collectors.** Revert the `db07e3d` wiring, stop Lever fetching its board page for a name, and stop `nameFromBoardTitle` and `nameFromSlug` running at collection. The utils and fixture stay for Phase 8. — AC 100–102
4. **Task 14 — build the Ashby collector.** Last, deliberately, so it is built once against rules that have stopped moving. `isListed` filter, `raw_company_slug` only, and the salary is the `summaryComponents` entry whose `compensationType` is `"Salary"` — not the first entry, which is equity.
5. **Task 15 — wire the `job-search` skill.** One step that runs the orchestrator and surfaces errors and warnings first.
6. **Task 16 — live one-job command.** Outside the default suite, no fixture written.
7. Then **Plan phase 2 — Tracing**, following the phase planning procedure.
