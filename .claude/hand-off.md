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

**Phase 3 (Normalization) is being built.** Tasks 1 to 6 of 13 are done and closed. Task 7, the work mode normalizer, is next.

**Everything is committed and pushed.** The working tree is clean at `1818bd4`. The suite runs 1001 tests across 35 files and lint is clean.

The count fell from 1005, on purpose. Retiring `salary_raw` took its assertions with it.

## Completed This Session

**Task 4 closed, after two splitting faults were found and fixed.** Reading the printout of all 627 fixture titles turned up two bugs a green test suite had missed. A bracket deleted outright welded the job word to what followed it, so `UI/UX Designer(6 months Contract)` lost `Designer` and fell back. A dash cut only with a space on both sides, so `UX/UI Designer- REMOTE` never split. Fallbacks went from 39 to 29 of 627, or 6.2% to 4.6%.

**Task 5 — multi-word level spellings.** A level's match list holds phrases, matched longest first. `Entry-Level` and `Mid-Level` joined the seeded list. One real title gained a level: `Mid-level UI/UX Developer`.

**Task 6 — the salary normalizer.** `normalizeSalary` reads the stored `raw_salary` envelope directly and takes an `unknown` value it checks itself. Cents divide before rounding, `1 YEAR` reads as `year`, a non-number reads as absent. `salary_raw` is retired from the whole module, along with `buildSalaryRaw` and its line in `readSalaryFromText`.

**Eight acceptance criteria written.** The phase spec had a task 5 with no test list at all. The criteria now run to 105, and the two pointers in the phase r&d moved to `AC 104` and `AC 62`.

**Three decisions logged**, all signed off in conversation.

## Decisions & Context

The decision log is the authority. What follows is only what is not written down elsewhere.

**`normalizeSalary` reads the envelope, not a translated shape.** It could have kept its old `{ low, high, period, currency }` input and let the later normalizer service map the keys onto it. It reads the envelope instead, because every criterion is written that way and it keeps source knowledge out of the service. Not logged as a decision — the criteria already settle it.

**Gotchas that will bite again:**

- **A criterion can look like it tests something and not.** Criterion 29 first read `Mid-Level Product Designer`. That is one word after tidying, so the shorter `mid` never competed and the criterion proved nothing. It needed the two-word spelling `Mid Level`.
- **A crowd-code writer cannot run tests.** One writer stated its code passed and it would have failed `1 YEAR` outright. Both rounds this session were settled by comparing the two outputs, never by trusting one.
- **Adding a seeded value broke a test nothing pointed at.** The level list lives in three files. Each now names the other two, but the same trap sits under every other seeded list.
- **A guard test that passes on its first run is still worth writing.** Three of the eleven tests added this session passed immediately. Each exists to catch a fix reaching too far — `U.S.` must not become `U S`, `AI-Enabled` must not split, and the hyphenated `Entry-Level` must keep matching.

**Approaches abandoned:**

- **Turning all nine punctuation characters into a space.** It breaks `U.S.` into `U S`. The full stop is the one that stays deleted, since inside a word it abbreviates rather than separates.
- **Cutting at every dash.** It would rescue more titles but destroys `AI-Enabled` and `Front-End`, which criterion 39 requires whole.
- **Winning a level phrase by list order.** Rejected in favour of phrase length. See the first open thread below.

**Open threads:**

- **The slash gap.** Needs a decision. See next steps.
- **Level phrase matching wins by length.** Needs a discussion. See next steps.
- The coverage figures in the phase 3 r&d are now marked as an example rather than a current reading, so they are no longer a stale-data problem.
- Carried from previous hand-offs, none blocking: the four silent source assumptions in the Phase 1 r&d are still unguarded; Phase 2's AC 15 printing half still has no standing test; the no-overfitting decision is rule-shaped and may belong in `docs/DECISIONS.md`.

## Next Steps

1. **Discuss how a level phrase should win, before task 9 hardens it.** When both `mid` and `mid level` match at the same word, the code picks the one covering more words. The alternative was first-entry-in-the-list wins. Phrase length was chosen because these lists get an editing screen in Phase 13, and a user reordering rows should not silently change what a title normalizes to. That reasoning has not been agreed, and the same question will come back for head nouns and removal words. It lives in `longestLevelMatch` in `lib/title.ts`.

2. **Decide what to do about a slash gluing a job word.** Three fixture titles hold a word that is already on the closed list, stuck to its neighbour by a slash so nothing matches: `ServiceNow Business Analyst/UX` twice, and `UxS Program Management SME/Analyst with Security Clearance`. A slash cannot simply be split on, because `UX/UI` and `TS/SCI` must survive whole — criterion 11 requires it. Options are to leave it, to match a job word against the parts of a slashed token, or to split only where a part is on the closed list. This is a rule question, not a vocabulary one, and it is written up in the phase 3 r&d.

3. **Build task 7 — the work mode normalizer.** Its own function, never reusing `readWorkModeFromText`'s `normalizeMode`, and inheriting no rule that an unrecognised word means `in-person`. Criteria 64 to 70 are the test list. Every entry in `raw_mode_list` maps to one of `remote`, `hybrid`, `in-person`; `onsite`, `OnSite` and `on-site` all give `in-person`; an unrecognised word is dropped rather than emptying the list; the result holds each mode once.

4. **Then task 8 — the company name normalizer.** In place, proven a fixed point against `lib/company-names.fixture.json`, the 1,324 names committed in task 2.

5. **Then task 9 — the normalizer service.** The one entry point the orchestrator calls, recomputing every field from its raw source. This is where the title, salary, work mode and company name functions get wired together.

6. Every task is test-first. `test-driven-development` runs before implementation, and `crowd-code` writes both the tests and the code. Compare the two writers rather than taking either at its word.
