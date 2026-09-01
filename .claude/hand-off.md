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

**Phase 3 (Normalization) is being built.** Tasks 1 to 12 of 13 are done and closed. Task 13, the proof, is next, and closing the phase follows it.

**Everything is committed and pushed.** The working tree is clean at `9a54aa0`. The suite runs 1143 tests across 40 files. `npm run lint` exits 0 and now runs the type checker too.

Normalization runs for real. `runCollection` reads the four title vocabularies once, normalizes every job that survives the usability check, writes a trace row per field it acted on, and folds unusable salaries and work modes into one warning line per collector at the end of the run.

## Completed This Session

**Task 7 — the work mode normalizer.** `normalizeModeList` in `lib/work-mode-list.ts` maps a source's own spellings onto `remote`, `hybrid` and `in-person`. A word it does not recognise is dropped. `lib/work-mode.ts`'s `normalizeMode`, which turns anything unrecognised into `in-person`, is not reused — that default is right for reading prose and wrong over a source's own field.

**Task 8 — the company name normalizer.** `normalizeCompanyName` trims, collapses doubled spaces, and drops a trailing run of anything that is not a letter or digit. Measured against all 1,324 committed names: 76 change, 0 drift on a second pass.

**Task 9 — the normalizer service.** `normalizeJob` routes four raw fields to their normalizers and returns a new job. Every present field is recomputed each call, with nothing asking whether the answer is already filled in.

**Task 10 — tracing.** `normalizeJob` returns the events it produced. Nine reasons, two events, `detail` carrying before and after, cut at 200 characters.

**Task 11 — warnings.** `summarizeNormalizationWarnings` folds unusable fields into one line per collector per reason, with a count and the first two examples.

**Task 12 — the wiring.** Normalization runs inside `runCollection`.

**Two unplanned fixes, both approved in conversation.**

`Mid` was a level in its own right alongside `Mid-Level`, which would have filed one rung under two stored names. It came from a draft line in the phase r&d, never a decision. `Mid-Level` now owns every spelling of that rung.

Ten test files each hand-built a `SettingsService` and all ten had gone stale. `lib/settings-service.fake.ts` replaced them, and `npm run lint` now runs `tsc --noEmit` so the next one is caught.

## Decisions & Context

The decision log is the authority. What follows is only what is not written down elsewhere.

**Three calls made without sign-off.** These are proposals, not decisions. Each has a real consequence and none was put to the user during the work.

- **The trace `detail` limit is 200 characters.** Picked from measurement: longest real title 131, longest real company name 50. Named as `MAX_DETAIL_LENGTH` in `lib/normalizer.ts`.
- **`normalizeJob` returns plain reasons, not finished trace rows.** A trace row needs a run id the function never receives, so the orchestrator adds the run id, the job id and the step. This is what lets one function serve both the pass after collection and the pass after parsing.
- **A missing raw field leaves its target alone rather than clearing it.** No `raw_salary` means an existing `salary_low` survives. Criterion 61 reads either way; this is the reading that never destroys data.

**Gotchas that will bite again:**

- **`normalizeTitle("")` answers with an empty title rather than refusing.** Calling it without checking first wipes a title an earlier pass wrote.
- **`normalizeSalary({})` answers with an empty object.** One crowd-code writer passed empty envelopes straight through, which turned a real salary of 900 into nothing. Verified by running it.
- **Zero out of zero reads as a perfect score.** A salary envelope holding only a currency has nothing countable in it. `lib/normalizer.ts` checks "nothing came out" before "everything came out" for exactly this reason.
- **Three existing tests asserted over every trace row.** True while collection was the only writer, false now. Any new pipeline step breaks tests the same way. They are `search-orchestrator.test.ts` twice and `trace-proof.test.ts` once.
- **A crowd-code writer cannot run tests.** Every round this session was settled by comparing two outputs and running the code, never by trusting a writer's claim.

**Approaches abandoned:**

- **Splitting a slash where one side is a known job word.** Built and measured. It flips `matched` to true but the whole string still lands in the role with no level and no team. Logged as a decision.
- **Filtering warning reasons in the orchestrator.** The orchestrator passes every normalization event to `summarizeNormalizationWarnings` and lets it drop the seven silent ones. A second copy of that list would drift.
- **A raw null byte as a Map key separator.** It works, but it is invisible in source. `lib/normalization-warnings.ts` writes it as a `\u0000` escape instead.

**Open threads:**

- The three unsigned calls above.
- Criteria 93 and 96 cannot be met until a parsing phase exists to call the normalizer a second time. Phase 8.
- Carried from previous hand-offs, none blocking: the four silent source assumptions in the Phase 1 r&d are still unguarded; Phase 2's AC 15 printing half still has no standing test; the no-overfitting decision is rule-shaped and may belong in `docs/DECISIONS.md`.
- `docs/DECISIONS.md` does not exist. The lint-runs-typecheck decision reaches past this feature and should be promoted there when `clean-decision-logs` runs.

## Next Steps

1. **Build task 13 — the proof.** The funnel answered from the database in SQL, offline, with no query code in `lib/`. Criterion 98 names the question: "how many titles normalized, by collector". `lib/trace-proof.test.ts` is the pattern — it already spins up a real database, runs a collection, and reads rows back with raw SQL in the test file. Criterion 96, reading each step by its own latest event, belongs here if it can be written against one step.

2. **Close phase 3.** Update `docs/features/unified-pipeline/architecture.md`, the decision log, and `BACKLOG.md`. This has its own checkbox because a phase whose close lives inside its build item gets ticked with the architecture doc still stale.

3. **Then plan phase 4 — Company Association.** Its r&d already carries the open questions, including what a normalized company name match actually compares, which this phase has now answered: an exact string after a cosmetic tidy, with case and internal spacing left alone.

4. Every task is test-first. `test-driven-development` runs before implementation, and `crowd-code` writes both the tests and the code. Compare the two writers rather than taking either at its word, and run anything either one claims.
