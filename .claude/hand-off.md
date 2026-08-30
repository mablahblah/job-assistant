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

Feature: **Unified Job Pipeline** — thirteen phases on the long-lived branch `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 1 (Collection) is complete.** All 18 tasks are checked and the build item is closed. Nothing is in flight.

**The working tree is clean and pushed through `185b85a`.** No modified files.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md`, read with `phase-01-collection-r&d.md` beside it. It keeps **two parallel numbered lists** — User Stories 1–80 and Acceptance Criteria 1–116. A reference like "AC 33" always means the criteria list. Confusing the two is how four stale criteria once survived an audit. Numbers never move: a withdrawn entry keeps its number so its neighbours keep theirs.

## Completed This Session

**Task 17 — the employer off a result card.** A live run found the task 16 drop rule discarding every job both page-reading collectors produced, because neither wrote a company. Both sites name the employer in an element of its own, so taking it is not parsing. `ResultCard` gained `company`; both card readers fill it; both `cardToJob` functions write `raw_company_name`, omitting it when blank. Committed as `eb9db06`, planned in `036b900`.

**Task 18 — the `job-search` skill.** Emptied to one step running `npm run collect`, reporting every error and warning before the job list. Its old step imported `./lib/collectors/collect-all` and read `save.saved`, none of which exists here. Committed as `f5ba056`.

**The live one-job command moved to the backlog** as #25, Live Collector Check, with a feature r&d carrying its withdrawn stories and criteria verbatim. That closed the phase. Committed as `185b85a`.

**Verified:** `npm run test` 852 passing across 31 files, up from 832. `npx tsc --noEmit` exit 0, `npm run lint` exit 0. A live run returned **373 jobs** — adzuna 119, jsearch 28, greenhouse 57, lever 12, ashby 53, dribbble 7, uiuxjobsboard 97 — with all 104 card-collected jobs carrying a company and none dropped.

## Decisions & Context

Signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — it is the authority. Three were added: the card collectors collect the employer, the card reader's checks stay put, and the live check is deferred. One 2026-08-27 entry was **superseded** — it said a card collector reads only the title and not the company.

**Where this session's findings already live:**

- **Phase 1 spec** — stories 79–80 and AC 112–116 cover the employer; AC 58, 69 and 106 were amended; stories 47, 65, 66 and AC 61, 68, 69 are withdrawn.
- **Phase 1 r&d** — the live-run drop counts, both fixture measurements with their selectors, and the JSearch timeout.
- **`docs/features/live-collector-check/feature_r&d.md`** — why the live check may never be needed, its four settled constraints, its criteria verbatim, and its two edge cases.

**Measured live on 2026-08-29:**

- **Dribbble names the employer in `span.job-board-job-company`** — 14 of 14 non-advertisement cards in the saved fixture.
- **uiuxjobsboard names it in `h3 span.text-xl > span`** — 100 of 100 — where the employer is that element's **first text node** and a nested `span.text-base` holds the words "is hiring". Reading `textContent` yields `"iCapitalis hiring"`. A test with an employer literally named `"This is hiring co"` is what proves the label is excluded structurally rather than string-matched.
- **Neither site exposes a company slug**, so both write `raw_company_name` alone.
- **JSearch's local search timed out at 15s on both runs.** A warning, not an error, and a data point for backlog item 22, Large Board Payload Handling.

**Constraints and gotchas:**

- **No git hook runs the tests.** There is no `.husky/`. The suite runs when invoked; `/commit-and-push` runs it through `verification-before-completion`. The "test gaps / risk score" output on every commit is the `code-review-graph` PostToolUse hook analysing structure — it runs no tests and its gaps are non-exported internals covered through public callers.
- **`npm run collect` rewrites both fixtures**, at `dribbble.ts:136` and `uiuxjobsboard.ts:137`. Using a real run as a health check mutates the baseline the offline tests compare against.
- **Each site has two card builders** — one in `*-cards.test.ts` for the reader, one in the collector test. Adding a field means updating both.
- **uiuxjobsboard's collector test stubs with `categoryRoute`, not `singleTermRoutes`**, because the site is browsed by category paths. Copying a test across from Dribbble fails with `singleTermRoutes is not defined`.
- **`limit: 1` makes an ATS collector shallow** — `greenhouse.ts:92` breaks out of the board loop after the first job, so 1 of 13 boards is polled.
- **crowd-code writers HTML-escape only when the output must contain angle brackets.** 2 of 10 escaped this session, both on the uiuxjobsboard piece whose CSS selector holds a `>`. Check before applying.
- **TDD's RED cannot be observed under crowd-code**, which orders code before tests. Mutation testing substitutes: break the production line, confirm the intended tests go red, restore.
- **`npx tsx -e` cannot run top-level await.** Write a real file; absolute paths reach `lib/`.

**Open questions:**

- **The four silent source assumptions** in the Phase 1 r&d, still unguarded. The usability check does not catch them — they produce well-formed jobs with quietly wrong data.
- **Two doc smells in the Phase 1 r&d**, surfaced and not fixed: a duplicated `## Measured during the build` heading, and a stale line saying uiuxjobsboard keeps a visible browser, which the 2026-08-27 decision removed.
- **Backlog #4, "Ashby API Collector", is built** and its entry says it stays only until it is. Flagged last session too.
- The Phase 3 and Phase 4 questions in their r&d files: whether Association's two passes differ, whether JSearch's employer name can be trusted for a match, whether a slug match should correct a stale seeded name, and what normalizing a title does.

## Next Steps

1. **Run `/audit` as a post-phase-1 pass.** This is the next action, before any phase 2 work.
2. **Then plan phase 2 — Tracing**, following the phase planning procedure. It already carries three obligations from Phase 1: retrofitting traces into all seven collectors, tracing the search-term drop, and surfacing a source that answered but sent nothing.
3. Clear the two r&d doc smells and backlog #4 when convenient — none blocks phase 2.
