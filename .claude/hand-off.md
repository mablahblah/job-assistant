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

**Phase 3 (Normalization) is being built.** Twelve of fourteen tasks are done. Task 13 — the step contract — is next, and it is a code change. Task 14, the proof, follows it. Closing the phase comes last.

**Everything is committed and pushed.** The working tree is clean at `e35c5a0`. The suite runs 1,143 tests across 40 files. `npm run lint` exits 0 and runs `tsc --noEmit` after ESLint.

Nothing was written to `lib/` this session. The whole session was a live proof run, a shape problem it exposed, and the paperwork settling it.

## Completed This Session

**A live end-to-end run.** `npm run db:create`, `npm run db:seed`, then `npm run collect` with no limit. 383 jobs collected, none dropped, 805 normalization events written. Per collector: adzuna 134, uiuxjobsboard 118, greenhouse 57, ashby 53, lever 12, dribbble 9, jsearch 0. jsearch failed with `Network timeout after 15s`. Twelve titles could not be filed, six of them internships. The scratch scripts live in `data/proof/`, which git ignores.

**A shape problem found and settled.** The normalizer is called one job at a time from inside collection's per-collector loop. The feature spec says every step is handed a job list. Phase 3's spec has 105 acceptance criteria and none mentions a job list, so the build passed all of them while drifting.

**`.claude/rules/pipeline-steps.md`.** The step contract, written down and scoped to `lib/` and `scripts/`. The rules checklist passes on seventeen of nineteen checks; the two failures are the glob's breadth, which phase 3a fixes.

**`docs/features/unified-pipeline/phases/phase-03a-steps-folder-spec.md`.** Phase 3a moves the steps into `lib/steps/` and narrows the rule's glob. It carries no plan step and no meeting note.

**`docs/CURRENT-FEATURE.md` cut from 105 lines to 80.** Phases 1 and 2 keep their task lists in their own specs and show one line each here. Phase 3 gained task 13 and phase 3a sits between phase 3 and phase 4, so nothing renumbered.

**Five decision log entries, one superseded.** The superseded one named a "fixed character limit" without saying what it was.

## Decisions & Context

The decision log is the authority. What follows is only what is not written down elsewhere.

**Gotchas that will bite again:**

- **The `Trace` comment contradicts itself.** `prisma/schema.prisma:135` says "Only collection writes today", then two lines later says both normalization passes write. The second is also wrong — parsing has no code yet.
- **A signed decision does not match the code.** Decision log line 161 says the `Trace` comment states a fallback title still got written. The comment does not say it. That is criterion 97, and it is not met.
- **`level`, `role` and `team` are computed and thrown away.** `normalizeTitle` returns all three, `normalizeJob` keeps only `title`, and the schema has no columns for them.
- **A step name is plain text.** `TraceEvent.step` is typed `string`, so a typo makes a whole pass vanish from the trace table with nothing failing. A union type would catch it. Not logged in `BACKLOG.md` yet.
- **`npm run collect` dirties the working tree.** It refreshes `lib/collectors/fixtures/dribbble.html` and `uiuxjobsboard.html` by design. Commit them or the next `git status` looks wrong.
- **The Bash working directory persists between tool calls.** A stale `cd` wrote the rule file to `docs/.claude/rules/` before it was caught.
- **Text landed inside `CURRENT-FEATURE.md` while it was open in the IDE.** Task 14 read "the funnel answered 1, nofrom the database". Fixed in `e35c5a0`, but it reached a pushed commit first.

**Approaches abandoned:**

- **Renumbering phases 4 through 13.** Measured at 105 text mentions and 10 file renames. Phase 3a costs nothing by comparison.
- **Scoping the step rule to the two step files by name.** It would then not load when someone creates a *new* step, which is the case the rule exists for. The broad glob stays until `lib/steps/` exists.

**Open threads:**

- **Two calls still unsigned**, carried from the previous hand-off. Where a trace row gets finished — superseded by the step contract, so it resolves itself in task 13. And a missing raw field leaving its target alone rather than clearing it, which is still nobody's decision.
- **Criteria 93 and 96 cannot be met until phase 8** builds parsing and calls the normalizer a second time.
- **Criterion 97 is not met.** See the gotcha above.
- **`docs/DECISIONS.md` does not exist.** Three entries now reach past this feature and have nowhere to go: lint running the type checker, a closed phase's tasks living in its spec, and the pipeline step contract.
- Carried and not blocking: the four silent source assumptions in the phase 1 r&d are still unguarded, and phase 2's AC 15 printing half still has no standing test.

## Next Steps

1. **Build task 13 — the step contract.** `lib/normalizer.ts` gains a list-shaped entry point that loops and writes its own trace rows; `normalizeJob` stays underneath, unchanged, as the per-job core. `lib/search-orchestrator.ts` moves the call out of its per-job loop to after collection finishes, and passes down the run id and the step name `post_collection_normalization`. Seven files reference the two. `.claude/rules/pipeline-steps.md` is the contract to build against. Test-first, and run anything a writer claims.

2. **Build task 14 — the proof.** The funnel answered from the database in SQL, offline, with no query code in `lib/`. `lib/trace-proof.test.ts` is the pattern: it spins up a scratch database, runs a real collection with fake collectors, and reads rows back with SQL written in the test file. Criterion 98 names the question — "how many titles normalized, by collector".

3. **Close phase 3.** Four documents. `architecture.md` is stale in five places: its Status section still says phase 3 is unbuilt, its Services table has no normalizer row, its Data Model omits `title`, `normalized_mode_list` and the four title vocabularies, it says collection writes "one step and six reasons" when it is now two and fifteen, and Ported From Legacy has no phase 3 row. The feature spec turns its Vocabulary sentence about job lists into a platform story so future phases get criteria written against it. The decision log is current. `BACKLOG.md` gets its sweep, plus the union-typed step name as a new item.

4. **Then phase 3a.** Its spec is written and its three open questions are settled. It is a move, an import update, a glob, and one type extraction.

5. Every task is test-first. `test-driven-development` runs before implementation, and `crowd-code` writes both the tests and the code. Compare the two writers rather than taking either at its word, and run anything either one claims.
