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

**Nothing is in progress.** Phase 6, Dedupe, is built and closed. Six of fourteen phases are closed. The next unit of work is clearing the open threads below, then planning phase 7, URL Resolution, which has no spec yet.

Working tree clean, nothing unpushed, at `e842521`. **1,728 tests across 64 files, `npm run lint` exits 0**, both verified fresh at session close. The session started at 1,662 across 61.

**The post-collection pass is complete end to end.** `npm run collect` runs collection → normalization → association → dedupe → save, and leaves rows behind.

## Completed This Session

**Phase 6 tasks 8 through 15, its close, and two changes outside it.** Twenty-two commits, all pushed.

- **Task 8** — `pickWinner` returns `{ dataWinner, idSurvivor }`; `created_at` moved into a new `STRIPPED_AT_WRITE_FIELDS`.
- **Task 9** — `lib/job-dedupe.ts`, the in-list fold.
- **Task 10** — `lib/dedupe-warnings.ts`, one `lookup_failed` kind.
- **Task 11** — `lib/steps/dedupe.ts` plus three lookups added to the job service and its fake. 20 tests.
- **Task 12** — dedupe's five trace events and the six-value `detail` on a losing row. 12 tests.
- **Task 13** — save's two new rows: `abandoned` where no row held the id, `job_dbrow_delete_refused` where the guard refused, and the dedupe reason carried onto both plus `job_dbrow_deleted`.
- **Task 14** — dedupe wired between association and save in the orchestrator.
- **Task 15** — the trace proof gained a dedupe block running against a real SQLite file.
- **The close** — architecture doc, `trace-events.md`, decision log, two superseded phase-5 criteria, phase 6's task list collapsed to one line.
- **A bug fix outside the phase** — `lib/collectors/paginate.ts`, the empty-search warning.
- **A refactor outside the phase** — `lib/trace-detail.ts`, the 200-character cut in one place.

**Verified against live data, twice.** Run 1: 21 jobs collected, one genuine Adzuna duplicate folded, 20 rows written. Run 2: the same 21 re-found, all 20 matched their stored rows, **table stayed at 20 — zero duplicates created.** The shared-host veto correctly refused to merge two distinct Duolingo greenhouse reqs whose dates were inside the 30-day window.

`pipeline.db` now holds that real data: **20 jobs, 296 trace rows, 2 runs.** Not a fresh database any more.

## Decisions & Context

### Decisions the user made

- **`Trace.detail` holds a named shape per event kind, not one loose `Record<string, string>`.** Their words: "yes, cont", after asking what widening the type would do. A loose record stops the compiler checking any detail shape, so a misspelled key would reach the database unnoticed. Logged.
- **The 200-character detail cut lives in one place.** Their words: "Can this live in 1 place?" — chosen over the backlog item that was proposed. Logged.
- **The dribbble empty-search rule does not go in the decision log.** Their words: "No." It stays as work-documentation in `lib/collectors/paginate.ts`.

### Calls made while building, not put to the user

These were offered for recording in the phase 6 spec and the offer was not taken up, so they live here only.

- **A stored row pulled onto the list gets `added_to_job_list` whether or not its id survived.** It joined either way. A row that then loses gets two rows in one step — that one and its deletion.
- **The step returns survivors first, then everything marked away.** Save needs the losers on the list to delete their rows; nothing depended on the order.
- **A claim keeps the clause that first tied a row to it.** A second entry folding into an existing claim names that original clause, not whichever one matched the second entry.
- **Every `detail` value is truncated, including the ISO date and the clause** — uniform rather than only the fields that can run long.
- **The dribbble fix judges emptiness at the collector level.** A broken selector empties every search; a genuinely empty one sits beside siblings that found cards. This is why `paginate` reports `foundNoCards` instead of warning, and `noCardsWarnings` speaks only when every search came back empty.
- **`truncateDetail` is a util, not a method on the trace service.** The fake trace service in step tests only records, so truncating at the write would be invisible to every step test that asserts it.

### Gotchas found this session

- **Prisma's JSON input needs an implicit index signature, which TypeScript gives a `type` alias and withholds from an `interface`.** `DedupeTraceDetail` failed to compile as an interface and works as a type. Both new detail shapes are types for this reason.
- **`Job.company_id` is a real foreign key.** A test seeding a job row with a `company_id` must seed the company first, or the write fails on the constraint.
- **Two stored rows with identical `created_at` tie**, and `pickIdSurvivor` returns the `earlier` argument. A test asserting which one survives must give them distinct birthdays or it is asserting an arbitrary outcome. One test written this session did that and was wrong, not the code.
- **`npm run collect` rewrites collector fixtures** as a side effect. Any verification run leaves `lib/collectors/fixtures/*.html` modified. That is intended — it is how the offline markup test keeps its baseline — but the run does not announce it.
- **The efficiency check still has to be run by hand.** The dedupe step measured linear: 57 → 129 → 264 → 535 ms as the list doubles from 500 to 4,000 jobs. Nothing in the rubric asked for it.

### Approaches refused, so they do not come back

- **A loose `Record<string, string>` for `TraceDetail`.** It never grows, and it stops the compiler checking any shape.
- **Packing a losing row's six values into one string.** The `detail` column is Json so structure survives; a packed string cannot be queried.
- **Truncating inside the trace service.** Invisible to every step test, because the fake only records.
- **Silencing the no-cards warning per search.** It would go quiet on a genuinely broken selector, which is the only thing the check exists for.

### Open threads

Clearing these is the first task — see Next Steps.

1. **Whether `lib/job-label.ts` earns a decision-log entry.** Offered twice across two sessions, never answered.
2. **Whether the code-quality rubric gains an efficiency line.** Two options were put up and deferred: a line in `~/.claude/references/rubrics/code-quality-criteria.md` asking whether the work scales to real input, or a measurement step in `crowd-code` for changes that loop over a collection. The recommendation was the rubric line alone.
3. **The contested-link guard test is missing from `lib/job-service.test.ts`.** The fake has it, the real service does not. Offered three times, never answered.
4. **`DEDUPE_REASONS` and the `Trace` comment can drift apart** with nothing complaining.
5. **`tableIndexes` in `prisma/schema.test.ts` has no test of its own.** Offered, never answered.
6. **There are now eight merge groups** in `lib/job-merge.ts`, three of them saying "the merge does not settle this" — `NEVER_WRITTEN_FIELDS`, `DERIVED_AT_WRITE_FIELDS`, `STRIPPED_AT_WRITE_FIELDS`. Whether three is right has never been asked.
7. **The writer-skipping decision is rule-shaped.** It is in the decision log dated 2026-09-09 but not yet written into `crowd-code`'s SKILL.md.
8. **Whether Phase 11a wants a database reset of its own.** In the phase 11a r&d.
9. **Phase 6 planning ran across several sessions and only the last has meeting notes.**
10. **`pipeline.db` holds two runs of real data.** Run `npm run db:create && npm run db:seed` for a clean slate, or keep it — a third run is a further test of the database compare, and phase 7 works on resolution, so a table holding 20 real unresolved jobs is useful rather than in the way.

**Closed since the last hand-off:** the fold algorithm shipped, is measured, is tested and is now proven on live data; the `company_id`+`title` index turned out to be task 1's all along.

### Carried forward, still true

**`cat` is blocked on any file over 2048 bytes** — use `sed -n 'START,ENDp'` or the Read tool. **The commit hook prints a graph analysis block** on every commit; harmless. **It also flags private helpers as untested** even where tests cover them through the module's public function. **`grep -r --include=*.ts` fails in this shell** — quote it as `--include="*.ts"`. **`timeout` is not on PATH** — use the Bash tool's own timeout parameter. **Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **Vitest output carries ANSI codes** — strip with `sed -e 's/\x1b\[[0-9;]*m//g'`. **`npx tsx -e` cannot run top-level `await`.** **`PIPESTATUS` does not survive** — use `cmd > file 2>&1; echo $?`. **`npm run lint` runs ESLint then `npx tsc --noEmit`**, with no `--max-warnings`, so a warning passes and a type error does not.

**A `crowd-code-writer` returns `<` and `>` HTML-escaped.** Convert them back before applying a snippet.

**After editing `prisma/schema.prisma`, run `npx prisma format` then `npx prisma generate`,** then `npm run db:create` and `npm run db:seed`.

**Anything new under `lib/steps/` loads two rules** — `.claude/rules/pipeline-steps.md` and `.claude/rules/naming.md`. **Anything touching `lib/collectors/registry.ts` loads a third**, `.claude/rules/source-registry.md`. Nothing path-scoped covers `lib/collectors/**` otherwise. **Editing any file under `.claude/rules/` goes through the `writing-rules` skill.** **A `docs/BACKLOG.md` change needs the user's approval before it is written.**

**Every message to the user over one paragraph ends with a one-sentence TL;DR.**

## Next Steps

1. **Clear the open threads.** They are the first task. Several have been carried for three sessions, and each is small.

   **Six need one answer from the user, and nothing else:**
   - Thread 1 — does `lib/job-label.ts` earn a decision-log entry?
   - Thread 2 — does the code-quality rubric gain an efficiency line? Recommendation: the rubric line alone.
   - Thread 3 — add the contested-link guard test to `lib/job-service.test.ts`?
   - Thread 5 — give `tableIndexes` in `prisma/schema.test.ts` a test of its own?
   - Thread 6 — are three "the merge does not settle this" groups right, or would two do?
   - Thread 10 — reset `pipeline.db`, or keep the two runs of real data?

   Ask all six together as plain text, not one per turn.

   **Three are work, and need no permission beyond the go-ahead:**
   - Thread 4 — tie `DEDUPE_REASONS` to the `Trace` comment so the two cannot drift. A test reading the schema file as text already exists in `prisma/schema.test.ts` to copy from.
   - Thread 7 — write the writer-skipping rule into `crowd-code`'s SKILL.md, through the `writing-skills` skill.
   - Thread 9 — backfill meeting notes for the phase 6 planning sessions that have none, or record that they will not be written.

   Thread 8 belongs to phase 11a and is answered when that phase is planned, not now.

2. **Plan phase 7, URL Resolution.** Follow [`phase-planning-procedure.md`](../docs/features/unified-pipeline/phase-planning-procedure.md), starting from the phase 7 r&d file in [`phases/`](../docs/features/unified-pipeline/phases/) if one exists. The spec is written into `phases/` and its tasks go under the build item in `docs/CURRENT-FEATURE.md`.

3. **Carry dedupe's obligation into the phase 7 spec.** Resolution must never write a `resolved_url` for a page that was not a job posting, and must leave the field empty where it cannot reach one. A generic careers page shared by several jobs gives them one key, and because matches chain, every job at that employer would collapse into a single row. It is in the decision log dated 2026-09-09 and dedupe cannot see the difference without sweeping the table.

4. **Then build phase 7,** following the working flow in [`feature_spec.md`](../docs/features/unified-pipeline/feature_spec.md#working-flow).
