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

Feature: **Unified Job Pipeline** — one feature, twelve phases, on the long-lived branch `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 1 (Collection) is building. Tasks 1 through 7 of 14 are done; 7 remain.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **task 8, the collector interface and orchestrator**.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md` — now 77 acceptance criteria and 14 ordered tasks. Read it with `phase-01-collection-r&d.md` beside it.

Working tree is clean. Everything is committed and pushed through `04dd6dc`.

The pipeline database exists at `pipeline.db`, created and seeded: one `Setting` row and 21 companies (13 Greenhouse, 3 Lever, 5 Ashby).

## Completed This Session

**Task 6 — search-term analyzer.** `lib/search-term-analyzer.ts` exposes `analyze`, which turns text into search tokens, and `matchesSearchTerms`, which the ATS collectors will call to filter their board results. `stemmer` is now a dependency. 15 tests cover AC 40–44 and 77.

**Task 7 — date util.** `lib/job-age.ts` exposes `parseAgeToDays`, `isPastThreshold`, and `ageToDate`, adapted from `legacy/lib/collectors/parse-age.ts`. 37 tests cover AC 70 and the strings every browser collector reads.

**A hole in the spec's stemming guard, found by measuring.** The guard was written as "tokens under three characters are not stemmed", but `uxs` is exactly three characters, so an "under three" guard skips it and the stemmer turns it into `ux`. Ten real `UxS ...` titles then matched the search term `UX`. The rule is now "three characters or fewer", which drops all ten and loses no real `UX` title. Spec AC 30 and 43 and the r&d file are corrected, and the decision log entry is superseded.

**The spec gained AC 77**, appended rather than inserted, because inserting shifts every number after it and silently breaks the Tasks list and the Edge Cases table.

**Every guard was proven by breaking it.** Weakening the length cutoff to "under three" fails two tests. Swapping the Unicode split for `[^a-zA-Z0-9]+` fails two more. Pinning `isPastThreshold` back to a hardcoded 8 fails three. Making its boundary exclusive fails one.

Verified at each commit, all exit 0 — `npm run test` 167/167 across 7 files, `npm run lint`, and `tsc --noEmit`. `dev.db` was read but never written.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. Four were touched this session: the analyzer entry was superseded to carry the corrected cutoff, and three were added covering the blank search term, the `isPastThreshold` shape, and the committed title fixture.

**Analyzer shape:**

- `analyze(text)` splits on any run of characters that are neither letters nor numbers, lowercases, then stems tokens of four characters or more.
- The split is Unicode-aware. A plain `[^a-zA-Z0-9]+` breaks `Ingénieur` into `ing` and `nieur`.
- `matchesSearchTerms(title, terms)` analyzes the title once and reuses it across every term.

**Date util shape:**

- `isPastThreshold(days, threshold)` takes a day count, not the age string, so a collector reads each card once and then asks.
- Its `days` parameter is `number`, never `number | null`. A collector that skips the unreadable-string check therefore fails to compile.
- The boundary is inclusive. Exactly `threshold` days old counts as past it.
- `parseAgeToDays` returning null is the signal a collector acts on: stop paginating, report the string verbatim. That warning is task 10's work, not the util's.

**Constraints, all measured:**

- **No two-character token is altered by the Porter stemmer.** Every short token it does alter is three characters — `uxs`, `uis`, `ais`, `qas`, `hrs`. That is why the cutoff had to move to "three or fewer" and why hunting for a two-character counterexample is a dead end.
- **`stemmer` 2.0.1 is ESM-only** and works unchanged under tsx and Vitest, because `tsconfig.json` sets `module: esnext`.
- **`npx tsx -e "<code>"` cannot use top-level await.** It transforms to CommonJS and throws a TransformError. Write a real script file instead.
- **`resolveJsonModule: true` is already set**, so a test imports a fixture with `import fixture from "./ux-titles.fixture.json"`.
- **`noUncheckedIndexedAccess` is NOT set**, so `match[1]` on a `RegExpMatchArray` is `string`, not `string | undefined`. No `?? "0"` fallback is needed.
- **The measured UX counts have drifted** since planning, from 592 and 22 to 603 and 24, because `dev.db` kept growing. The user ruled the spec's numbers do not matter, and no test asserts a count.

**Approaches tried and dropped:**

- **Asserting the counts 603 and 24 in the AC 40 test.** The fixture is the source of truth and its size is not a fact worth pinning. The test asserts that the wrongly-matched list is empty and names any offenders.
- **Moving the month check ahead of the day check in `parseAgeToDays`.** One writer proposed it against future day-word variants. Speculative, and the proven order already gives every right answer.
- **Validating search terms in the settings service.** Three options were on the table — the analyzer guard, a settings check, or both. The guard won because no settings page exists yet to validate at. The constraint is recorded in `docs/features/settings-page/feature_r&d.md` for when that page is built.

**Working with the writer agents.** Two per chunk, tests first and implementation second, with the failing test run in between. A correction sent mid-flight does reach a running agent and it revises. On the two implementations the outputs were near-identical both times; on the test files they diverged enough that combining was worth the read. One test file carried a wrong date, `2023-01-16` for 365 days before `2024-01-15`. Check date arithmetic rather than trusting it.

## Next Steps

1. **Task 8 — collector interface and orchestrator.** One shape for every collector, a limit argument, per-collector catch, errors and warnings returned, per-collector logging, and a warning when an ATS platform has no boards to poll. — AC 14–16, 18, 20–25, 76
2. **Task 9 — port the four API collectors.** Adzuna, JSearch, Greenhouse, Lever — stripped, renamed canonically, company names fetched once per slug, JSearch's dropped half surfaced, Adzuna's remote search left without a radius. — AC 27–29, 31–35, 46–48, 66, 71–72
3. **Task 10 — port Dribbble and uiuxjobsboard.** The first users of `lib/job-age.ts`. Title read off the card, pagination stop, six-page ceiling, per-search self-checks, fixture writing. uiuxjobsboard keeps its visible browser. — AC 49–55, 58–60, 62, 65
4. Tasks 11 through 14 follow in the spec's order, which puts the working collectors before weLoveProduct and Ashby.
5. Each task is built test-first. Invoke `test-driven-development` before writing implementation code — the acceptance criteria are the test list.
