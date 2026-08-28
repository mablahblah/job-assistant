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

**Phase 1 (Collection) is building. Tasks 1 through 13 are done; four remain.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **task 14, giving the config tests room for a cold import**.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md`. Read it with `phase-01-collection-r&d.md` beside it. It keeps **two parallel numbered lists** — User Stories 1–78 and Acceptance Criteria 1–103. A reference like "AC 33" always means the criteria list. Confusing the two is how four stale criteria once survived an audit.

Code is committed and pushed through `50d0d99`. **Two doc files are modified and uncommitted:** the new task 14 in `docs/CURRENT-FEATURE.md` and the same task plus a rewritten task 15 in the phase 1 spec.

## Completed This Session

**Task 13 — the collectors interpret nothing.** Lever stopped fetching its board page to read an employer name out of the HTML `<title>`, so a Lever board costs one request. Greenhouse and Lever both stopped reading a work mode out of the description. Neither falls back to a name built from the board slug: Greenhouse reads `raw_company_name` off each posting's own `company_name`, and a posting carrying none leaves it empty. Both write `raw_company_slug`. Lever stores `workplaceType` as published, `onsite` included, because mapping it onto `in-person` is Phase 3's job.

**`titleFromHtml` and `nameFromBoardTitle` moved to `lib/board-title-name.ts`**, out of `collectors/`, unhooked and waiting for Phase 8. `resolveAtsCompanyName` was deleted rather than unhooked — its only job was the collection-time slug fallback that AC 31 withdrew.

**Three collector behaviours were sanctioned as exceptions** and commented where they happen: JSearch joining its three location fields, JSearch writing `remote` for its `job_is_remote` boolean, and the two card collectors turning an age phrase into `posting_date`. Tabled in the Phase 3 and Phase 8 r&d files so a later phase meets the rule and its exceptions together.

**Verified:** `npx tsc --noEmit` exit 0. `npm run lint` exit 0. `npm run test` exit 0 with 755 passing across 29 files, down from 765 — the AC 27, 29, 31 and 92 collector blocks went with the behaviour they described, and five new tests replaced them. Greenhouse's description read and a hard-coded Lever company name were each restored on purpose to confirm the new tests catch them — 3 failed, 78 passed — then reverted.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. Three were added this session, on the sanctioned exceptions, on a nameless Greenhouse posting, and on when unhooked code is kept versus deleted.

**The rubric settles this class of question.** `docs/features/unified-pipeline/feature_spec.md` holds a "What Each Step Owns" table. A collector "collects raw jobs, and every field its source hands over for free" and never "interprets anything — a figure it had to read out of prose is not free data." When something could plausibly live in two steps, that table decides it, and the test between normalizing and parsing is that normalizing reshapes a value that exists while parsing produces one that does not.

**Constraints and gotchas:**

- **`lib/ats-slug-name.ts` looks unhooked but is not.** `scripts/db-seed.ts:91` calls `nameFromSlug` to name a seeded company from its slug, which is a signed-off decision. Deleting it as dead code breaks the seed.
- **`company_name` is Greenhouse's own API field** on `GreenhousePosting`, not only our job-list field. Phase 8 lifts `toJobListEntry` out into a field mapper shared with the parser, and a careless rename there corrupts the API type.
- **The commit hook flags `cardToJob` and `toJobListEntry` as untested** on every commit. Neither is exported, so the graph cannot see the tests reaching them through `collect`. False positive, carried from last session.
- **AC 92 and AC 94 are covered in `lib/work-mode.test.ts`**, against the util rather than a collector. The collector-level copies were deleted without losing coverage. AC 29 and AC 31 correctly have no tests at all now.
- **`crowd-code` produced four near-identical files and all four missed the same thing:** comments explaining why a field is empty. Both Lever headers narrated what had been deleted, which the brief forbade, and neither Greenhouse output commented the hard-coded `raw_mode_list: []`. The one real split was `if (matched.length === 0) continue;`, which one agent per pair spotted now guards an empty loop. **Their output still arrives HTML-escaped.** Combining beat a second round, because the gaps were comments and the wording was already settled.

**Open questions:**

- The Phase 3 and Phase 4 questions carried in their r&d files: whether Association's two passes differ, whether JSearch's employer name can be trusted for a match, whether a slug match should correct a stale seeded name, and what normalizing a title does.

## Next Steps

1. **Commit the two modified doc files** — the new task 14 and the rewritten task 15 in the spec.
2. **Task 14 — give the config tests room for a cold import.** `prisma.config.test.ts` fails on time rather than behaviour under a loaded run. Its first test pays a cold `import("./prisma.config")`, measured at 322ms alone against 0–2ms for every other test in the file, and vitest's default ceiling is 5000ms. Add a `CONFIG_LOAD_TIMEOUT_MS` constant and pass it to the three `loadConfig()` tests in AC1 and to "loading prisma.config.ts throws when the lookup fails" in AC2, matching the `CREATE_TIMEOUT_MS` pattern in `prisma/schema.test.ts`. Not a global `testTimeout` — that turns a genuine hang into a long wait for all 755 tests.
3. **Task 15 — build the Ashby collector.** Last among the collectors, deliberately, so it is built once against rules that have stopped moving. `isListed` filter, `raw_company_slug` alone since its API carries no organization name, and the salary is the `summaryComponents` entry whose `compensationType` is `"Salary"` — not the first entry, which is equity. Its envelope is `{ salary_min: minValue, salary_max: maxValue, salary_period: "1 YEAR", salary_currency: "USD" }`, with no `salary_unit` because Ashby sends whole dollars. Seeded slug casing needs verifying against the live API. — AC 30, 36–37
4. **Task 16 — wire the `job-search` skill.** One step that runs the orchestrator and surfaces errors and warnings first. — AC 19
5. **Task 17 — live one-job command.** Outside the default suite, no fixture written. — AC 61, 68–69
6. Then **Plan phase 2 — Tracing**, following the phase planning procedure.
