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

**Phase 5, DB Save, is built and closed.** Five of fourteen phases are now closed.

**Phase 6, Dedupe, is mid-planning.** The brain dump is captured, orientation is done, and the discovery conversation settled the identity rules and the date handling. It stopped on one open question.

**The exact resume point: whether the company-and-title clause should fire only between two different collectors.** It is written up in full in the phase 6 r&d under the Phase 4 carry-in, as "the live open question". Answer it, then work the four remaining items in that file's "Still to settle" list, then write the phase 6 spec.

**Four files are uncommitted**, all documentation, all from the phase 6 planning conversation:

| File | What changed |
|---|---|
| `docs/features/unified-pipeline/decision-log.md` | Six new entries dated 2026-09-07 |
| `docs/features/unified-pipeline/feature_spec.md` | The dedupe match table and four new stories |
| `docs/features/unified-pipeline/architecture.md` | The Identity line in the vocabulary |
| `docs/features/unified-pipeline/phases/phase-06-dedupe-r&d.md` | Brain dump, FigJam flow, settled questions, measurements, what is still open |

**Five commits pushed this session.**

| Commit | What |
|---|---|
| `b711b9a` | Phase 5 build notes, carried over from the previous session |
| `62037cd` | The previous session's hand-off |
| `cbd7843` | Task 16 — the company service's conflict lookup |
| `5289748` | Future Idea 16, the orphan priority-list entry |
| `e66020f` | The phase 5 close |

**Verified at close, run fresh.** `npm run test` exits 0 with **1,545 tests across 56 files**. `npm run lint` exits 0, which runs ESLint then `tsc --noEmit`.

## Completed This Session

**Phase 5 task 16, the company service's conflict lookup.** A refused create names the clashing column at `meta.driverAdapterError.cause.constraint.fields`, measured on all three of `Company`'s unique columns. The service reads it and looks up that one column, keeping the try-each-in-turn path for a refusal naming none. `isUniqueConstraintError` became a type guard, which is what lets the error be read with no casts. Four tests added; three count the lookups so the code cannot silently return to guessing.

**Phase 5 closed.** The architecture doc gained eight parts — the job service, the save step, the merge, the date pooler, the source priority reader, the active statuses, the save warnings — and three were corrected. The three database commands are described there now. Four build notes went into the phase 5 spec. `CURRENT-FEATURE.md` traded its sixteen task lines for one link.

**Phase 6 planning, up to the open question.** Six decisions logged. The feature spec's dedupe rules rewritten to match them.

## Decisions & Context

**Six decisions are in the feature decision log dated 2026-09-07**, covering the three identity clauses, the 30-day window, chaining, dedupe writing no dates, the merge survivor, and collector credit. They are not repeated here.

**Nothing was logged for the phase 5 work.** All four calls made while building task 16 are in the phase 5 spec under "Calls made while building".

### Gotchas found this session

- **The false test-gap report comes from `.git/hooks/pre-commit`**, installed by `code-review-graph`, which runs `detect-changes --brief`. Its options cannot print the risk summary without the gap line, so the only fix is deleting that file. **The user chose to live with it.** Do not investigate it again.
- **It cannot see two shapes**: a test that runs code as a separate program, and a function only another function calls. This session it wrongly named `fakeCompanyService`, `withCompany`, `get`, `isUniqueConstraintError` and `isRecord`.
- **`dev.db` at the repo root is the old pipeline's database** and `sqlite3` reads it directly. 2,193 jobs. Its `firstPublished` and `repostedAt` columns produced the repost-gap measurement. Remember the old `dedupeByContent` already collapsed company and title, so that key's uniqueness there means nothing.
- **`PIPESTATUS` still does not survive in the shell tool.** Capture an exit code with `$?` after a redirect.
- **Both r&d files for phases 5 and 6 still say `createTraceWriter(db)`.** It is `createTraceService(db)` since 2026-09-07. Left alone deliberately — they are planning records, not live code.

### A test pattern worth reusing

Task 16's tests wrap a real Prisma client in a `Proxy` to record every `findUnique` the service runs, and a second `Proxy` strips the column name off a real refusal to prove the fallback still works. Nothing else in the codebase does this. It is what makes a test able to tell one targeted lookup from three tried in turn — the three pre-existing refusal tests pass under either implementation.

### How the build loop ran

Task 16: write the failing tests first, run them red, dispatch two `crowd-code-writer` sub-agents in parallel at Sonnet, pick a winner, apply, go green. Both writers returned near-identical structure. B won for making `isUniqueConstraintError` a type guard, which removed every cast from the error walk. **Telling the writers outright that this codebase has zero JSDoc blocks stopped them writing any, for the second session running. Keep that line.**

### Carried forward, still true

**Dedupe does not exist yet**, so two runs of `npm run collect` write two rows for one posting. Expected until phase 6 ships.

**Anything new under `lib/steps/` loads two rules** — `.claude/rules/pipeline-steps.md` and `.claude/rules/naming.md`. **Anything touching `lib/collectors/registry.ts` loads a third**, `.claude/rules/source-registry.md`. **A `BACKLOG.md` change needs the user's approval before it is written.**

**Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **`cat` is blocked on any file over 2048 bytes** by a hook. **Vitest output carries ANSI codes** — strip with `sed -e 's/\x1b\[[0-9;]*m//g'`. **`npx tsx -e` cannot run top-level `await`** — probe scripts need a `main()` wrapper.

### Open questions

1. **The live pipeline database is still on the old schema.** Rebuilding is `npm run db:create` then `npm run db:seed`. **The user has been asked four times across previous sessions and has not answered.** Not asked this session.
2. **The five phase 6 items** in that file's "Still to settle" list. Item 1 is the resume point.
3. **A merged row can name a parser that never parsed it.** Settle in Phase 8. Recorded in the phase 5 spec.
4. **A renamed collector leaves an orphan in the priority list.** Now Future Idea 16 in `BACKLOG.md`.
5. **Whether Phase 11a wants a database reset of its own.** `npm run db:reset` now exists. In the phase 11a r&d.

## Next Steps

1. **Commit the four uncommitted documentation files.** They are the phase 6 planning record and nothing else is outstanding.

2. **Answer the resume question: should the company-and-title clause fire only between two different collectors?** The full case is in the phase 6 r&d. In short: JSearch writes a job board's name where the employer goes, measured at 4 of 10 on a live search, so several unrelated jobs end up under a company called `Indeed`. Two of them sharing a normalized title match on company and title, pass the 30-day window because both were collected today, and merge — destroying a real posting. Chaining collapses a whole cluster of them. The proposal is that one source never lists a posting twice under two links, so the clause fires only across different collectors.

3. **Work the other four items in "Still to settle"** — the minimum repost gap, what dedupe writes to the trace, whether two matching database rows are ever reconciled, and what ports from `legacy/lib/dedupe.ts`.

4. **Finish `build-requirements`** — its phases 3 to 5, being user stories, the sub-agent stress test, and acceptance criteria.

5. **Write `phase-06-dedupe-spec.md`**, run `spec-review` on it, tick **Plan phase 6** in `CURRENT-FEATURE.md` with its task list under the build item, then run `wrap-up-planning`.
