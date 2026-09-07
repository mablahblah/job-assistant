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

**Phase 5, DB Save, is thirteen of sixteen tasks built.** Four of fourteen phases are closed. Tasks 1 through 13 are done and green.

**The pipeline now writes rows.** Before this session a collection run ended with a job list in memory. `runCollection` now calls save as its last step, so `npm run collect` creates what is new, updates what exists, refuses to delete a job holding an active status, and warns naming both rows when it does.

**The exact resume point: Phase 5 task 14, the registry rule** — a path-scoped rule on the collector registry files requiring `npm run db:seed` in the same change that touches one. Then task 15, the reset script, and task 16, the company service's conflict lookup.

**Everything is committed and pushed.** The working tree is clean.

**Eight commits pushed this session**, ending with the close-out commit that carries this file. Tasks 9 through 13, the naming rule, the renames it forced, and this session's writing.

| Commit | What |
|---|---|
| `1d67258` | The `TraceService` rename — 14 code files and 7 documents |
| `23ce0d3` | Tasks 12 and 13 — the orchestrator saves, and the trace proof follows |
| this one | This session's decision log and hand-off |

**Verified at close, run fresh.** `npm run test` exits 0 with **1,535 tests across 55 files**. `npm run lint` exits 0, which runs ESLint then `tsc --noEmit`.

## Completed This Session

Five tasks and one piece of unplanned work.

| What | Produced |
|---|---|
| Task 9 — Save's warnings | `lib/save-warnings.ts` and its test, 19 tests |
| Task 10 — The save step | `lib/steps/save.ts`, behaviour and trace-event test files, 42 tests |
| Task 11 — The seed | The source priority list built and appended to, 11 new tests |
| Naming rule | `.claude/rules/naming.md`, 46 lines, plus five renames |
| Task 12 — Wire it in | Orchestrator saves, 73 calls updated, 9 new tests |
| Task 13 — The trace proof | 4 calls updated, counts corrected, save scenario added, 5 new tests |

**Task 9 was widened.** Its spec named only the delete warning. Save raises two, and the failed write had no task of its own, so both kinds went into one tagged union.

**The naming work was not planned.** It came out of a question about one option name and turned into a survey of every source file, a rule, and six renames across three commits, the last of them `TraceService`.

## Decisions & Context

**The decision log is the authority for what was settled.** Four entries were appended, all dated 2026-09-07. Six calls went into the Phase 5 spec under "Calls made while building". What follows is only what is not written down elsewhere.

### Gotchas found this session

- **`Job.company_id` is a real foreign key** at `prisma/schema.prisma:86`. A test pairing a real job service with a fake company service writes a `company_id` no company holds, so every insert fails and the saved list comes back empty. `lib/trace-proof.test.ts` now pairs fake with fake and real with real.
- **Tasks 12 and 13 cannot be separated.** Making save's options required stops `lib/trace-proof.test.ts` compiling, and fixing that surfaces the row counts save shifted. Any future task that changes `CollectionOptions` breaks that file the same two ways.
- **`git mv` stages the rename immediately.** A later `git commit` of an unrelated file swept ten renames into it. Check `git status` before committing after any `git mv`.
- **A rename is not done when the types are done.** The `TraceService` rename left 12 comments across 7 files still saying "trace writer", plus five stale file paths in the docs.
- **`npx tsx -e` cannot run top-level `await`.** Probe scripts need a file with a `main()` wrapper, as `scripts/db-seed.ts` has.
- **The commit hook still reports false test gaps.** It named `labelJob`, `truncate`, `seedSourcePriority` and `main` as untested. All are covered, some through a subprocess the hook cannot see through.
- **Both `crowd-code` writers wrote the same wrong comment twice**, claiming a missing required option would "silently skip saving". A required option is a compile error. Read their comments, not just their code.

### Carried forward, still true

**The seed now writes `source_priority_list`.** A fresh database gets `collector:user` first, then all seven collectors in registry order.

**Save runs before dedupe exists**, so until Phase 6 two runs of `npm run collect` write two rows for one posting. Expected and short-lived.

**Historical documents are left for posterity.** Eleven mentions of "trace writer" remain in `meeting-notes/2026-08-30-...md`, `phase-02-tracing-spec.md` and `phase-04-company-association-spec.md`. Those are dated records of closed work. Live documents were updated.

**Anything new under `lib/steps/` loads two rules now** — `.claude/rules/pipeline-steps.md` for shape and `.claude/rules/naming.md` for names. **A `BACKLOG.md` change needs the user's approval before it is written.**

**Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **`cat` is blocked on any file over 2048 bytes** by a hook. **Vitest output carries ANSI codes** — strip them with `sed -e 's/\x1b\[[0-9;]*m//g'` before grepping it.

**Zero modules use JSDoc comment blocks** — all use `//`. Both `crowd-code` writers reach for JSDoc every time and it has to be converted.

### Open questions

1. **The live pipeline database is still on the old schema.** 21 companies, 1 setting, 0 jobs, 0 traces. Rebuilding is `npm run db:create` then `npm run db:seed`. Task 12 is the first thing that writes a job, so this now matters for a real run. **The user has been asked four times and has not answered.**
2. **A merged row can name a parser that never parsed it.** Settle in Phase 8. Recorded in the Phase 5 spec.
3. **A renamed collector leaves an orphan entry in the priority list.** The seed never removes. In the Phase 5 r&d, unagreed.
4. **Whether Phase 11a wants a database reset of its own.** In the Phase 11a r&d.

### How the build loop ran

Every task: write the test file first, run it red, dispatch two `crowd-code-writer` sub-agents in parallel, pick or combine, apply, go green, then break the code deliberately several ways and confirm every test catches its own break.

Break counts: 11 for `save-warnings` covering all 19 tests, 29 for the save step covering 41 of 42, and 10 for the seed covering all 11.

**One test cannot be broken from its own module.** "Whose row is active leaves both rows standing" in `lib/steps/save.test.ts` depends on a guard living in the job service, so no change to the step makes it fail. It proves routing, not the guard.

## Next Steps

1. **Build task 14, the registry rule.** A path-scoped rule in `.claude/rules/` on `lib/collectors/registry.ts`, requiring `npm run db:seed` in the same change that touches it. The reason: the seed appends any missing registry name to the priority list, so a collector added without seeding never ranks. Rules go through the `writing-rules` skill and need the user's approval before writing.

2. **Then task 15, the reset script.** `scripts/db-reset.ts` and its test, plus its `npm run` entry. It empties jobs, the companies collection created, and every trace row, sparing settings and companies carrying an ATS slug. Criteria 71 to 75 in the Phase 5 spec.

3. **Then task 16, the company service's conflict lookup.** `lib/company-service.ts` and its test. Read the clashing column off the refusal and look that one up, keeping the try-each-in-turn path as a fallback. Correct the comment at line 54, which says the column cannot be read. Criteria 76 and 77.

4. **Close phase 5** after building — architecture doc, decision log, and any backlog change presented for approval. Then take the 16 tasks back out of `CURRENT-FEATURE.md`, leaving one line linking to the spec.
