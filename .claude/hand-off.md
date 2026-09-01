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

**Phase 3 (Normalization) is being built.** Tasks 1 to 3 are done and closed. Task 4, the title normalizer, is built and passing but its box is deliberately unticked: the user has the before-and-after printout of all 627 fixture titles and has not yet said whether the output is acceptable.

Phase 3 now holds 13 tasks rather than 12. Task 5 is new and everything after it shifted by one.

**Everything is committed and pushed.** The working tree is clean at `a7c7d8d`. The suite runs 997 tests, up from 954 at session start. Lint is clean.

## Completed This Session

**Task 4 — the title normalizer.** `lib/title.ts` and `lib/title.test.ts`, 43 tests. A pure function taking a raw title and the four vocabularies as a plain object, returning `{ title, level, role, team, matched }`. It opens no database, so its tests need none. `matched` is false when no job noun was found anywhere, which is what the trace step will read to write `title_not_normalized`.

**Two open questions in the title rule settled,** both found by running real titles rather than by reading the spec. Step 1 now names the nine punctuation characters it deletes. Step 4 now says which run wins when a segment holds two runs of level words.

**Criterion 21 corrected and a full-sweep criterion added.** The old criterion assumed a longer removal list and asked for a role of `UX Designer` where the rule gives `US UX Designer`. New criterion 38 carries every effect the rule can have on a role in one title. The list runs to 97; the two references in the phase r&d were repointed to `AC 96` and `AC 54`.

**Task 5 added** — multi-word level spellings, with `Entry-Level` and `Mid-Level`.

**A backlog item logged** on Settings Page: preview what a title vocabulary edit does to every stored raw title before the edit is kept.

**Four decisions logged**, all signed off in conversation.

## Decisions & Context

The decision log is the authority. What follows is only what is not written down elsewhere.

**A green test suite did not settle the rule.** Two crowd-code writers both passed all 38 tests and still produced different output on 16 of the 627 real titles. Those 16 exposed both open questions. For the remaining tasks: passing tests are not evidence that a rule is finished — the fixture is.

**How the two implementations differed, since the reasoning is not in the code.** One deleted every character not on an allowlist, which destroyed `C#`, `UI/UX_Workflow` and `Concepteur·trice`. The other deleted only brackets, which left `*Senior` glued and lost the level. The named nine-character list is what came out of that, and it is the user's own list.

**Both writers converged on the same fix** in the second round — same regex, same first-run logic — so there was no choice to make.

**Gotchas that will bite again:**

- **The comma cannot be deleted during tidy.** Tidy is step 1, segmentation is step 2. Deleting commas first collapses every comma-separated title into one piece and breaks a dozen criteria.
- **Stripping full stops is safe for levels.** `Sr.` tidies to `Sr`, which the match list already holds, and the stored spelling puts the dot back. So `sr.` in the match list is now unreachable, harmlessly.
- **A background sub-agent finishing looks like permission to continue.** It is not. It pulled work forward past an unanswered question this session. The user is fixing this in their global config.

**Approaches abandoned:**

- **A `title_level_modifiers` setting** holding the word `level`, to strip it from a level run. The user's phrase-matching idea does the same job with no new column and does not eat `Level 2`.
- **Writer A's allowlist punctuation.** Mangles real words.
- **Writer B's give-up-on-two-runs.** Leaves `Senior` unnormalized, which is exactly what criterion 18 exists to stop.
- **Adding `*` to the punctuation list.** Deferred by the user for lack of data.

**Open threads:**

- **Four titles fall back that arguably should not,** all from the printout. `Principal UX Expert` — `Expert` is not on the noun list and ends `-ert`, not `-ect`. `ServiceNow Business Analyst/UX` — `Analyst` **is** on the list, but the slash glues it to `UX` so the last word matches nothing; this is a rule gap rather than a missing word, and it appears twice. `Entry Level UX Research Apprenticeship` — task 5 will not rescue this, because `Apprenticeship` is no job noun either. `Diseñador de Producto Senior` — Spanish, known and accepted at planning.
- Carried from previous hand-offs, none blocking: the coverage figures in the phase 3 r&d are still stale and were taken with an abandoned stop list; the four silent source assumptions in the Phase 1 r&d are still unguarded; Phase 2's AC 15 printing half still has no standing test; the no-overfitting decision is rule-shaped and may belong in `docs/DECISIONS.md`; there is no `salary_currency` column and a non-USD figure is indistinguishable from dollars.

## Next Steps

1. **Get the user's read on the 627 title printout** before ticking task 4. The four fallbacks above are the specific things to ask about. The file can be regenerated by running every fixture title through `normalizeTitle` with the seeded vocabularies.
2. **Tick task 4** in `docs/CURRENT-FEATURE.md` once they are happy.
3. **Build task 5 — multi-word level spellings.** A level's match list holds phrases, matched longest first. Seed `Entry-Level` and `Mid-Level`. Touches `lib/title.ts`, `scripts/db-seed.ts` and their tests. Criteria 12 and 19 in the phase spec are the new ones.
4. **Then task 6 — the salary normalizer.** Extend `lib/salary.ts` for cents, `1 YEAR`, the envelope keys and the `NaN` guard, and retire its `salary_raw` line.
5. **Re-measure the stale coverage figures** in the phase 3 r&d. The real rule now runs, so the numbers can be taken properly.
6. Every task is test-first. `test-driven-development` runs before implementation, and `crowd-code` writes both the tests and the code.
