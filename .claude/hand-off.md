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

**Phase 3 (Normalization) is complete — planned, built and closed.** Nothing is in flight. The next item is Phase 3a, which moves the steps into `lib/steps/`. Its spec is written and its open questions are settled.

**Everything is committed and pushed.** The working tree is clean at `748405b`. The suite runs **1,194 tests across 41 files**. `npm run lint` exits 0 and runs `tsc --noEmit` after ESLint.

No job site was reached this session. Every test uses fake collectors, and the two page-reading fixtures are untouched.

## Completed This Session

**Task 13 — the step contract.** `lib/normalizer.ts` gained `normalizeJobs`: it takes a job list, returns that list with the warnings it raised, and writes its own trace rows from the run id and step name its caller hands it. `normalizeJob` sits underneath unchanged as the per-job core. `lib/search-orchestrator.ts` lost 30 lines — its loop now only collects and stamps, and calls the normalizer once after every collector finishes. Forty new tests in `lib/normalizer-step.test.ts`, plus two in the orchestrator's own file proving the call happens once over the whole list.

**Task 14 — the proof.** Six tests added to `lib/trace-proof.test.ts`. A real collection runs against a throwaway SQLite file with a real title vocabulary, then raw SQL written in the test file answers "how many titles normalized, by collector". `SELECT` and `createClient` appear nowhere in `lib/` outside test files.

**Phase 3 closed.** `architecture.md` fixed in all five stale places. `feature_spec.md` gained the step contract and the trace-versus-warning split as platform constraints. `docs/BACKLOG.md` gained the union-typed step name. `CURRENT-FEATURE.md` collapsed phase 3's fourteen tasks to one line linking the spec.

**The `Trace` comment settled, and criterion 97 met.** The comment said only collection writes today and then said both normalization passes do. It now says collection and the one normalization pass after it. It also gained the sentence saying `normalization_failed` does not mean nothing was written. Four tests in `prisma/schema.test.ts` cover the nine normalization reasons, the four events and that sentence.

**`.claude/rules/pipeline-steps.md` gained a Trace and warnings section**, in the user's own words, with the older directives grouped under Shape. The rules checklist passes 17 of 19; the two failures are the broad glob that phase 3a closes.

**Two search issues carried over** from a `/job-search` run on `main`, brought across in a stash.

Nine commits, all pushed:

```
748405b docs: add the new normalizer test to phase 3a's import list
65f1686 docs: close phase 3
a16fa84 docs: bring the architecture and spec up to phase 3 as built
4b480f2 fix: settle what the Trace comment says about normalization
edb76b3 test: answer the normalization funnel from the database in SQL
b512f38 docs: log the trace and warning split, and close task 13
ba4fd75 docs: carry over two search issues logged on main
9e6c5eb feat: normalize the whole job list in one call after collection
1e87e91 docs: correct what the phase specs say about the step contract
937887a docs: state the difference between a trace row and a warning
```

## Decisions & Context

The decision log is the authority. What follows is only what is not written down elsewhere.

**Gotchas that will bite again:**

- **TypeScript will not narrow a trace writer from a saved boolean.** Hoisting `const canTrace = trace !== undefined && runId !== undefined && step !== undefined` out of the loop reads better but fails to compile, because `trace.write` still sees `TraceWriter | undefined`. The check stays inline. Every future step that traces hits this.
- **`title_normalized` means a head noun matched, not that the text changed.** "Product Designer" is recorded as normalized while reading back identical. A funnel query assuming normalized means changed will be wrong.
- **A salary envelope carrying only a period is thrown out whole.** `lib/salary.ts` returns `{}` as soon as both the minimum and maximum are missing, before it looks at the period word. So `{ salary_period: "week" }` is `salary_unusable`. Measured, not assumed.
- **Blanking a comment block in `schema.prisma` fails the comment tests for the wrong reason.** `traceComment()` matches only unbroken `//` lines directly above the model, so deleting a block leaves a gap that truncates it and every comment test fails at once. To isolate one failure, blank the lines in place.
- **The backlog lives at `docs/BACKLOG.md`**, not the repo root, though several docs call it `BACKLOG.md`.
- **`normalizer.ts` imports a type from `search-orchestrator.ts`, which points backwards.** It is type-only so it erases at compile time and no runtime loop exists. Phase 3a task 1 moves that type out.
- **`level`, `role` and `team` are still computed and thrown away.** `normalizeTitle` returns all three, `normalizeJob` keeps only `title`, and the schema has no columns for them.

**Approaches tried and abandoned:**

- **A separate proof file for task 14.** It would have copied about 90 lines of scaffolding and broken `trace-proof.test.ts`'s claim to be the only place a query is written anywhere in the project.
- **Putting the trace-versus-warnings split only in the decision log.** It went into the rule file as well, because that is what a step author actually reads.
- **A warnings callback, and reading warnings back out of the trace table.** Both were on the table for where a step's warnings go. Returning them won: the fake trace writer has no table to query, and a callback is harder to read in tests than a returned value.

**Open threads:**

- **One call is unsigned.** `normalizeJobs` skips a job carrying no `id` or no `collector` — it still normalizes it, but writes no trace row and raises no warning, because both are keyed by those two fields. Collection always sets both, so this is a guard. It sits in a code comment and its tests, not the decision log, because it was never put to the user.
- **Carried and still unsigned:** a missing raw field leaving its target alone rather than clearing it.
- **`docs/DECISIONS.md` does not exist.** Four entries now reach past this feature and have nowhere to go: lint running the type checker, a closed phase's tasks living in its spec, the pipeline step contract, and the trace-versus-warning split.
- **Criteria 93 and 96 wait on Phase 8.** Both describe the normalization pass after parsing. Recorded in the phase 3 spec under "Criteria this phase cannot meet". The normalizer already takes its step name from its caller, so Phase 8 meets them without changing anything.
- **The two search issues now live only on this branch** and will not reach `main` until cutover at Phase 12. `/process-search-issues` turns them into backlog items, and `docs/BACKLOG.md` is on this branch too, so that works from here.
- Carried and not blocking: the four silent source assumptions in the phase 1 r&d are still unguarded, and phase 2's AC 15 printing half still has no standing test.

## Next Steps

1. **Build Phase 3a — steps get their own folder.** Its [spec](../docs/features/unified-pipeline/phases/phase-03a-steps-folder-spec.md) carries five tasks, in order: move `CollectionIssue` out of `lib/search-orchestrator.ts` into `lib/collection-issue.ts`; create `lib/steps/` and move `search-orchestrator.ts` and `normalizer.ts` into it with their test files; repoint the imports in the eight files that reference them, re-running the search rather than trusting the list; replace both of the rule's `paths:` patterns with the single `lib/steps/**/*.ts` and re-run checks 1 and 2 of the rules checklist; update the architecture doc's Services table paths. `lib/collectors/` stays where it is — a collector is not a step. The only edit to any test file is its import path.

2. **Then plan Phase 4 — Company Association**, following the [phase planning procedure](../docs/features/unified-pipeline/phase-planning-procedure.md). Its r&d file holds the open questions.

3. **Every task is test-first.** `test-driven-development` runs before implementation, and `crowd-code` writes both the tests and the code. Compare the two writers rather than taking either at its word, and run anything either one claims. Where a test is written over code that already works — as task 14's proof was — break the code on purpose and confirm the test fails, because a test that passes first time proves nothing on its own.
