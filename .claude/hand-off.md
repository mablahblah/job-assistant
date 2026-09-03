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

**Phase 3a is complete.** Every pipeline step now lives in `lib/steps/`, and the step contract rule is scoped to that folder. Nothing is in flight. The next item is planning Phase 4, Company Association.

**Everything is committed and pushed.** The working tree is clean at `efcff0e`. The suite runs **1,194 tests across 41 files** — the same count as before the move. `npm run lint` exits 0 and runs `tsc --noEmit` after ESLint.

No job site was reached this session. No test fixture changed. No behavior changed: every code edit was a file move or an import path.

## Completed This Session

**Phase 3a — steps get their own folder.** All five tasks, all seven acceptance criteria.

`lib/steps/` holds the two steps and their four test files:

```
lib/steps/search-orchestrator.ts   + search-orchestrator.test.ts
lib/steps/normalizer.ts            + normalizer.test.ts
                                     normalizer-events.test.ts
                                     normalizer-step.test.ts
```

`lib/collection-issue.ts` is new. The `CollectionIssue` type lived on the orchestrator, so `lib/normalization-warnings.ts` — a helper — imported from a step. It reads the type from its own file now. The orchestrator does not re-export it; every consumer reads it from `lib/collection-issue.ts`, which gave `scripts/collect.ts` two imports where it had one.

`.claude/rules/pipeline-steps.md` frontmatter went from `["lib/**/*.ts", "scripts/**/*.ts"]` to `["lib/steps/**/*.ts"]`. That was the point of the phase: the rule used to load while someone edited `title.ts` or `salary.ts`, where it has nothing to say. Checks 1 and 2 of the rules checklist now pass — check 1 wants `paths:` not `globs:` and a pattern that will not catch irrelevant files, check 2 wants no over-broad pattern. One pattern, six files.

`lib/collectors/` did not move. A collector is not a step.

`architecture.md` names both new paths in its Services table, and its status line states where a step lives rather than describing 3a as pending. Phase 3's spec had one stale path at line 363 and now names `lib/steps/search-orchestrator.test.ts`.

Five commits, all pushed:

```
efcff0e docs: mark phase 3a done and repoint phase 3's test path
683305f docs: point the architecture doc at the new step paths
b34e48c chore: scope the step contract rule to lib/steps
8d26bd9 refactor: move the pipeline steps into lib/steps
bfadefe refactor: give CollectionIssue its own file
```

## Decisions & Context

The decision log is the authority. Nothing was added to it this session. What follows is only what is not written down elsewhere.

**Gotchas that will bite again:**

- **`lib/steps/search-orchestrator.test.ts:673` reads its own source file off disk.** It builds the path from its own folder plus the string `"search-orchestrator.ts"`. It survived this move only because the test moved with the source. Separating them breaks it.
- **A phase spec's list of files to repoint is raw search output.** Phase 3a's task 3 listed eight files, including two that were about to move. Reading such a list as "these all stay put" is wrong. The spec says re-run the search, and that is why.
- **No build config names a step path.** `vitest`, `eslint`, `tsconfig` and `package.json` were all grepped. A step can move without touching any of them.
- Carried and still true: **TypeScript will not narrow a trace writer from a saved boolean**, so the `trace !== undefined && runId !== undefined && step !== undefined` check stays inline in every step that traces. **`title_normalized` means a head noun matched, not that the text changed.** **A salary envelope carrying only a period is thrown out whole** — `lib/salary.ts` returns `{}` once both the minimum and maximum are missing. **Blanking a comment block in `schema.prisma` fails the comment tests for the wrong reason** — blank the lines in place to isolate one failure. **The backlog lives at `docs/BACKLOG.md`**, though several docs call it `BACKLOG.md`.

**Approaches tried and abandoned:**

- **`crowd-code` for the build.** The feature procedure calls for it, and it was skipped once by explicit agreement because the phase was a file move with no new logic. This was a one-off, not a standing change. Every future task goes through `crowd-code`.

**Open threads:**

- **Two calls made this session are unsigned and were not put to the user as decisions.** First, all of a step's test files move with it, while `trace-proof.test.ts` stays in `lib/` because it exercises the whole pipeline rather than one step. Second, a stale path in a closed phase's spec gets repointed when a later phase moves the file. Neither is in the decision log.
- **Backlog Future Ideas item 7, "Reorganize `lib/` folder structure", overlaps what 3a just did.** Whether to trim or reword it was raised and not answered.
- **`docs/DECISIONS.md` does not exist.** Four entries reach past this feature and have nowhere to go: lint running the type checker, a closed phase's tasks living in its spec, the pipeline step contract, and the trace-versus-warning split.
- **Carried and still unsigned:** `normalizeJobs` skips a job carrying no `id` or no `collector` — it still normalizes it, but writes no trace row and raises no warning, because both are keyed on those two fields. It sits in a code comment and its tests. Also carried: a missing raw field leaving its target alone rather than clearing it.
- **`level`, `role` and `team` are still computed and thrown away.** `normalizeTitle` returns all three, `normalizeJob` keeps only `title`, and the schema has no columns for them.
- **Criteria 93 and 96 wait on Phase 8.** Both describe the normalization pass after parsing. Recorded in the phase 3 spec under "Criteria this phase cannot meet". The normalizer already takes its step name from its caller, so Phase 8 meets them without changing anything.
- **The two search issues live only on this branch** and will not reach `main` until cutover at Phase 12. `/process-search-issues` turns them into backlog items, and `docs/BACKLOG.md` is on this branch too, so that works from here.
- Carried and not blocking: the four silent source assumptions in the phase 1 r&d are still unguarded, and phase 2's AC 15 printing half still has no standing test.

## Next Steps

1. **Plan Phase 4 — Company Association**, following the [phase planning procedure](../docs/features/unified-pipeline/phase-planning-procedure.md). Its open questions are in [phase-04-company-association-r&d.md](../docs/features/unified-pipeline/phases/phase-04-company-association-r%26d.md). Planning writes `phase-04-company-association-spec.md` beside it and puts that phase's tasks into `CURRENT-FEATURE.md` under its build item.

2. **Then build it.** Every task is test-first: `test-driven-development` runs before implementation, and `crowd-code` writes both the tests and the code. Compare the two writers rather than taking either at its word, and run anything either one claims. Where a test is written over code that already works, break the code on purpose and confirm the test fails, because a test that passes first time proves nothing on its own.

3. **Anything new under `lib/steps/` now loads the step contract** in `.claude/rules/pipeline-steps.md`. A new step goes in that folder; a helper it calls stays in `lib/`.
