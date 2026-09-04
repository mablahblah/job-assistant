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

Feature: **Unified Job Pipeline** — a long-lived branch, `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 4, Company Association, is being built. Tasks 1, 2 and 3 of 13 are done.** Nothing is in flight. The next item is task 4, the company store.

Three commits are pushed: `401a2b3`, `aecefaf`, `e273f00`. **One file is modified and uncommitted:** `docs/features/unified-pipeline/phases/phase-04-company-association-spec.md`, holding an edge-case correction and the record of calls made while building.

The suite runs **1,215 tests across 42 files**, up from 1,194. `npm run lint` exits 0 and runs `tsc --noEmit` after ESLint. No job site was reached. No test fixture changed.

## Completed This Session

**Task 1 — the schema.** `prisma/schema.prisma`: `Company.name` is optional, `match_key` is a new unique column, `ats_slug` gained `@unique`, the `Trace` comment carries association's four events and six reasons, and the comment on `Job.company_id` says association decides the company while save writes the column. The client was regenerated.

`lib/settings-service.ts` changed with it. `AtsCompany.name` typed a company name as always present, which the optional name makes untrue. Only `tsc` reported it.

**Task 2 — the schema tests.** `prisma/schema.test.ts` gained 10 checks: `match_key` in the expected Company columns, `name` nullable, both new unique columns refusing a duplicate through a real insert, association's vocabulary in the `Trace` comment, and the `Job.company_id` comment.

**Task 3 — the match key.** `lib/company-match-key.ts` exports `companyMatchKey(name)`. It takes the runs of letters and digits, lowercases each, drops a trailing run of legal-entity words, and joins with no separator. `lib/company-match-key.test.ts` holds 14 tests covering criteria 7 to 16, including all 44 recorded merge groups.

Running the rule over all 1,324 committed company names gives **1,280 distinct keys, 44 groups merging, 0 empty keys** — reproducing the r&d's recorded measurement exactly.

## Decisions & Context

The decision log is the authority. Nothing was added to it this session. What follows is only what is not written down elsewhere.

**What the user decided:**

- **A phase task list that names an implementation file before its test file is still built test-first.** Task 1 was the schema and task 2 its tests; they were swapped. A test written after the code passes on its first run and proves nothing.
- **A regression a later task will cause is written into the phase spec's regression net when it is found**, rather than deleted early or sent to the backlog. The backlog is read when picking a feature, not when building the task.
- **A procedural decision — what to do next — is not logged.** Only decisions about the app, project, or feature qualify. This one is rule-shaped rather than feature-shaped, so it is flagged here rather than written into any log. Global decisions are promoted after the feature ships, so `docs/DECISIONS.md` still not existing is not a problem to solve now.

**Calls made while building** are recorded in the phase spec under "Approach", as work-documentation. They cover the function's name, one scratch database rather than two, the 44 groups sitting inline in the test, the schema being edited directly rather than through `crowd-code`, and `AtsCompany.name` being made nullable rather than deleted.

**Gotchas that will bite again:**

- **The type checker sees what the tests cannot.** Making `Company.name` optional broke `lib/settings-service.ts` while all 1,201 tests passed. Vitest strips types without checking them, so `npm run lint` is the only thing that catches a schema change breaking a type.
- **A test that only compares two results to each other proves nothing.** Criteria 10, 11 and 12 ask that two keys be equal. A stub returning one constant for every input passed all three. Found by deliberately running exactly that stub, and fixed by pinning the actual value as well.
- **`modified_at` has no database default.** `created_at` gets one from `@default(now())`, but `@updatedAt` produces none, so a raw SQL insert into `Company` must supply `modified_at` itself.
- **A company name of pure punctuation still keys to an empty string.** The fallback calls `normalizeCompanyName`, which strips it to nothing too. The phase spec claimed the fallback closed this and has been corrected. The step is what closes it, by treating an empty name as no name.
- **`lib/settings-service.test.ts:283` will fail at task 8.** Its `a company carries its name alongside its slug` test reads a name off the seeded `hinge-health` company, and the new seed stops writing one.
- **The phase 4 spec's line numbers were accurate** — `EXPECTED_COMPANY_COLUMNS` really is at line 50 and the two exact-equality assertions at 341 and 415. That is not guaranteed for later tasks; re-check before trusting them.
- Carried and still true: **`lib/steps/search-orchestrator.test.ts:673` reads its own source file off disk**, so separating that test from its source breaks it. **Blanking a comment block in `schema.prisma` fails the comment tests for the wrong reason** — blank the lines in place to isolate one failure. **TypeScript will not narrow a trace writer from a saved boolean**, so the three-part `!== undefined` check stays inline in every step that traces. **`title_normalized` means a head noun matched, not that the text changed.** **A salary envelope carrying only a period is thrown out whole.** **The backlog lives at `docs/BACKLOG.md`**, though several docs call it `BACKLOG.md`.

**Approaches tried and abandoned:**

- **Running the fixture measurement in Python.** The `regex` module is not installed, and Python's built-in `re` has no Unicode property escapes. Node was the better tool anyway, since it is the runtime the real rule runs in.

**Open threads:**

- **Whether `AtsCompany.name` exists at all is task 8's call.** Nothing reads it: it appears only in `lib/settings-service.ts` where it is declared and `lib/collectors/ats-boards.ts` which passes it through, and the three ATS collectors read `ats_slug` alone. This is a different thing from `Company.name`, the column the Web UI shows the user.
- **The `Ryan Specialty` and `Ryan Specialty Group` merge** is the one of the 44 worth re-reading if the legal-entity word list is ever changed, since it is the only merge that depends on `group` being on the list.
- Carried: **backlog Future Ideas item 7, "Reorganize `lib/` folder structure", overlaps what phase 3a did**, and whether to trim it is unanswered. **`normalizeJobs` skips a job carrying no `id` or no `collector`** — it normalizes it but writes no trace row and raises no warning. **`level`, `role` and `team` are computed and thrown away.** **Criteria 93 and 96 wait on Phase 8.** **The two search issues live only on this branch** until cutover at phase 12. **The four silent source assumptions in the phase 1 r&d are still unguarded**, and phase 2's AC 15 printing half still has no standing test.

## Next Steps

1. **Commit the one modified file** — `phase-04-company-association-spec.md` — before starting anything.

2. **Build task 4, the company store.** `lib/company-store.ts` and its test: look up by slug, look up by key, create, fill an empty name, and refuse to create a record carrying neither a name nor a slug. It takes the caller's database client and hands back a small object, the way `createTraceWriter(db)` and `createSettingsService(db)` already do, so the step opens no database of its own.

3. **Then tasks 5 to 13 in order**, as listed in `docs/CURRENT-FEATURE.md`. Task 8, the seed, is where the `AtsCompany.name` question gets answered and where `lib/settings-service.test.ts` needs changing.

4. **Every task is test-first.** `test-driven-development` runs before implementation, and `crowd-code` writes both the tests and the code. Where a task lists an implementation file before its test file, swap them. Run the tests against a deliberately wrong stub before implementing, because that is what exposed the equality-only weakness this session.

5. **Anything new under `lib/steps/` loads the step contract** in `.claude/rules/pipeline-steps.md`. Task 7's `company-association.ts` goes in that folder; the store, the match key and the clash warning are helpers and stay in `lib/`.
