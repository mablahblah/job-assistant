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

**Phase 3 (Normalization) is planned and not built.** Every step of the phase planning procedure ran: brain dump, orient, discovery, spec, two review passes, tracking, and wrap-up.

**Nothing is committed.** The whole session is in the working tree — thirteen modified files and two new ones. No code was written; this was planning only, so the test suite is untouched at 924 passing.

Modified: `docs/BACKLOG.md`, `docs/CURRENT-FEATURE.md`, and in `docs/features/unified-pipeline/` — `architecture.md`, `db-entries.md`, `decision-log.md`, `feature_spec.md`, `phase-planning-procedure.md`, and the r&d files for phases 3, 4, 8 and 13. New: `phases/phase-03-normalization-spec.md` and `meeting-notes/2026-08-31-phase-03-normalization-meeting-notes.md`.

Also modified and **not part of this session**: `.claude/hand-off.md` (this file, dirty at session start) and `.claude/skills/generate-resume/SKILL.md`, which was already dirty and nothing here touched.

## Completed This Session

**Phase 3 planned end to end.** The spec carries 57 stories, 93 acceptance criteria, confirmed edge cases, 12 build tasks, the regression net, and the approach.

What normalization will do: reshape `raw_title`, `raw_salary`, `raw_mode_list` and `raw_company_name` into `title`, the three salary columns, a normalized mode list, and a tidied company name in place. It opens no database, drops no job, and never reads a description. It runs after collection and again after parsing as one service, recomputing every field from its raw source each pass.

The title rule is eight general steps: tidy, cut into segments, the role segment is the last holding a job noun, take out the contiguous level run only when a job noun survives, the whole role segment is the role, every other segment is team joined alphabetically, job nouns match a closed list before agent-noun suffixes, and no job noun means the tidied string is kept.

**Twenty-three decision-log entries**, including the `raw_` convention superseded to the user's definition — a raw field holds what a collector was handed, may be cleaned in place, and is never read by scoring or the Web UI.

**A stress test across four sub-agents** over the stories, which found the `NaN` guard hole, the Prisma `null`-versus-`undefined` mismatch, `normalizeMode`'s wrong default, and the empty-list-is-not-absence problem. All are criteria now.

**Two spec-review passes.** The second found four problems the first did not, including two criteria that needed opposite readings of the same phrase and a duplicate criterion giving two answers for one title. Running the second pass was the user's suggestion and it earned its keep.

**Documents corrected rather than deferred:** the feature spec's company-name story plus its missing salary and work-mode stories, `db-entries.md`'s salary fields and column names, the architecture doc's planning status, and two r&d open questions this session answered.

**The phase planning procedure was rewritten.** Steps 1 to 3 now say the brain dump is captured and nothing else happens to it, orientation produces no conversation of its own, and `build-requirements` is invoked immediately. This session's discovery happened in conversation before the skill was invoked, which is exactly what the rewrite prevents.

## Decisions & Context

The decision log is the authority and holds every decision from this session. What follows is only what is not written down elsewhere.

**Gotchas, all hit this session:**

- **A sub-agent's task notification can arrive with no result body.** Two of four did. `SendMessage` to the agent asking it to restate what it found recovered both without re-running the work.
- **Verify any number a sub-agent reports before writing it down.** One agent reported "14 of 627" adjacent level words — it is 9 — and "29% of titles" for a shape I could not reproduce at all. Both reached the spec as measured facts before being checked.
- **Renumbering stories or criteria breaks the edge-case table's cross-references.** It happened twice. Remap by matching story text; arithmetic on the old numbers is wrong because insertions shift different ranges by different amounts.
- **A patched scratch script's numbers are not evidence.** The throwaway normalizer was silently dropping `&` from role text through its tokenizer charset, and one patch broke the segment splitter so a title fell through entirely. The 94.7% it reported afterwards was meaningless.
- **`isPresent(NaN)` returns true and `Math.round("abc")` is `NaN`,** verified live, so the existing salary guard does not fire and `NaN` reaches an `Int` column.
- **`Company.name` is `@unique` with no `COLLATE NOCASE`.** Verified against SQLite: `GitLab` and `Gitlab` insert as two rows.
- **`docs/CURRENT-FEATURE.md` kept its ticks.** The previous hand-off warned it had silently lost two; re-reading after every edit is the habit that caught nothing this time.

**Approaches tried and abandoned:**

- **Cutting the title at the first comma or dash.** Dropped coverage to 93.7% because `Advanced Specialist, UX Designer` made the wrong half the role. Replaced by "the last segment holding a job noun."
- **Stripping the first level word unconditionally.** Cost 1.8 points and broke `Director, UX`, which lost its only noun. Replaced by "only when a job noun survives without it."
- **Splitting team on `&` and `and`.** Done before the role segment was chosen it tore `UI/UX Designer & Developer` in half; moved after, it still broke `Inspire & Motivate`. Dropped entirely — they are ordinary characters now.
- **A stop list for the suffix net,** built from the words this corpus wrongly matched. Abandoned as overfitting: a list fitted to these 603 titles would not cover what a different corpus throws up.
- **Seeding the head-noun list from search terms,** and requiring every search term to contain a noun. Measured against the fixture: narrowing to noun-bearing terms costs about a quarter of what is collected.
- **Four exceptions that dissolved** once overfitting was named — bracket carve-outs for `(UX)`/`(UI)` and for `(Senior)`, an `of`-phrase rule, and a trailing-content rule. Each was absorbed by an existing general step rather than replaced.

**Open threads, none blocking:**

- **The coverage figures in `phase-03-normalization-r&d.md` are stale.** They were measured with the abandoned stop list and before the junk rules changed. The closed-list share is unaffected because it runs first; the suffix and fallback shares need re-measuring at build. The user has said there is no coverage target, so this is a review artifact rather than a gate.
- **The user wants a full before/after list at build time** for the title normalizer, read rather than asserted against a threshold.
- **The four silent source assumptions** in the Phase 1 r&d, still unguarded. Carried in the last four hand-offs.
- **Phase 2's AC 15 printing half** still has no standing test; forcing a trace write failure through the CLI is the blocker.
- **The no-overfitting decision is rule-shaped rather than feature-shaped** and may belong in `docs/DECISIONS.md` or a rule file. Left for `clean-decision-logs` at ship time.
- **`.claude/skills/generate-resume/SKILL.md`** is modified, untouched by this session, and was already dirty when it began.

## Next Steps

1. **Commit this session.** Nothing is committed. Two new files and thirteen modified ones, all documentation.
2. **Build Phase 3**, following the 12 tasks under **Build phase 3** in `docs/CURRENT-FEATURE.md`, in order. Task 1 is the schema — `title` and the normalized mode list on `Job`, the title vocabularies on `Setting`. Run `npx prisma generate` after editing `schema.prisma`; `db push` does not regenerate the client.
3. **Task 2 comes early on purpose.** The company-name fixture is pulled once from `dev.db` and committed, so the company normalizer's tests hold still while job searches keep running on `main`.
4. **Every task is test-first.** `test-driven-development` is invoked before any implementation code, and the acceptance criteria in the phase spec are the test list.
5. **Name the mode column at task 1.** The spec calls it a normalized mode list; `db-entries.md` currently writes it as `normalized_mode_list`, which is a suggestion rather than a decision. Three mode fields will eventually coexist — `raw_mode_list`, this one, and classification's `work_mode` — so the name should not read as a duplicate of either.
6. **Close Phase 3** after building — architecture doc, decision log, `BACKLOG.md`.
