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

**Phase 6, Dedupe, is in build. Tasks 1 to 10 of 15 are done.** Five of fourteen phases are closed.

**The spec is [`phase-06-dedupe-spec.md`](../docs/features/unified-pipeline/phases/phase-06-dedupe-spec.md)** — 18 stories, 90 acceptance criteria, 15 tasks. Its task list is mirrored under the build item in `docs/CURRENT-FEATURE.md`, where tasks 1 to 10 are ticked.

**Nine files are uncommitted** — tasks 8, 9 and 10 in full:

- New: `lib/job-dedupe.ts`, `lib/job-dedupe.test.ts`, `lib/dedupe-warnings.ts`, `lib/dedupe-warnings.test.ts`, `lib/job-label.ts`
- Modified: `lib/job-merge.ts`, `lib/job-merge.test.ts`, `lib/save-warnings.ts`, `docs/CURRENT-FEATURE.md`

Everything through task 7 is committed and pushed, at `23b174a`.

**Verified fresh at session close.** `npm run test` exits 0 with 1,662 tests across 61 files. `npm run lint` exits 0. The session started at 1,591 tests across 57 files.

## Completed This Session

**Five spec tasks built**, tasks 6 through 10, plus one util extracted that the spec does not name.

Six commits, all pushed:

- `2d3c76c` — docs: record the combined index decision
- `24b2527` — docs: refresh the hand-off for the phase 6 build
- `42367d1` — feat: dedupe's three identity clauses
- `8bfc324` — docs: tick phase 6 task 6
- `e015978` — feat: the hard-vs-repost match label
- `23b174a` — docs: tick phase 6 task 7

**Task 6 — `lib/job-identity.ts`.** `matchingClause(a, b)` returns `JobIdentityClause | null`, naming the first clause that fires: `original_url`, `resolved_url`, `company_and_title`. Every clause is gated on both sides carrying its fields. The company-and-title clause needs the same `company_id` and the same normalized `title`, and both sides' latest dates within 30 days. The shared-host veto blocks that clause where both resolved links parse to one host but key differently. 22 tests, criteria 24 to 36.

**Task 7 — `lib/job-match-label.ts`.** `matchLabel(job)` reads the gap between a merged job's two pooled dates and returns `hard_match_in_list` under 24 hours, `repost_match_in_list` at 24 hours or more. One date or none reads as hard. 8 tests, criteria 37 to 41.

**Task 8 — `lib/job-merge.ts`.** `pickWinner` is exported and returns `{ dataWinner, idSurvivor }`. `created_at` moved out of `NEVER_WRITTEN_FIELDS`, which now holds `modified_at` alone, into a new `STRIPPED_AT_WRITE_FIELDS`. `mergeJobs`, `pickWinner` and `contest` renamed their sides to `earlier` and `later`. The file went from 196 to 244 lines; its test from 388 to 522, at 56 tests. Criteria 42 to 48 and 50.

**Task 9 — `lib/job-dedupe.ts`.** `foldMatchingJobs(jobs, priorityList, collectedAt)` returns `{ jobs, folds }`. Each fold record carries `loser` (a copy marked with `delete_on_save`), `becameId`, and `clause`. 20 tests, criteria 51 to 54 and 56 to 58.

**Task 10 — `lib/dedupe-warnings.ts`.** One `lookup_failed` kind, one line out per warning, following `lib/save-warnings.ts` rather than the folding style. 8 tests, criterion 66.

**`lib/job-label.ts`**, holding `labelJob`, extracted out of `lib/save-warnings.ts` so task 10 could use it without a second copy. Not a spec task — see the open threads.

**No decision log entry was written.** Nothing this session passed the decision-log rule's qualification test.

## Decisions & Context

### Decisions the user made

None that qualify. The user approved building tasks 6 through 10 and deferred three questions to next session, but made no call in their own words with a fork on the table.

### Calls made while building, not put to the user

- **The identity clauses build each link's key rather than reading it.** `matchingClause` calls `urlMatchKey(entry.original_url)` instead of reading `original_url_match_key`. Only the job service stamps those columns and only at write time (`lib/job-service.ts:71`), so a freshly collected entry carries neither, and reading the column would leave both link clauses dead on the post-collection pass — dedupe's main one. This was stated to the user before building; they did not object either way.
- **The shared-host veto reads the host through `new URL(...).host`** rather than slicing it back out of the match key. One writer hand-rolled the slice; the platform parser already answers it.
- **`matchLabel` returns the trace reason itself**, not a bare `"hard"` / `"repost"` that task 9 would glue into a reason string. The decision log rules out assembling a reason rather than returning a stable code.
- **`JobMatchLabel` is `Extract<DedupeReason, ...>`, listing the two reasons positively.** `Exclude<DedupeReason, "matched_db_row">` was the other writer's answer; it would silently widen the label type the first time a fourth reason joins `DEDUPE_REASONS`.
- **The new merge group is `STRIPPED_AT_WRITE_FIELDS`**, named for what the job service does to it, pairing against `DERIVED_AT_WRITE_FIELDS`, which the job service builds instead.
- **The merged `id` falls back to the other side's id where the survivor carries none.** The surviving-id rule alone would drop an id in the one existing test where the priority winner carries none, and a filled value beating an empty one is the merge's own principle.
- **Type names take the `Job` prefix** — `JobIdentityClause`, `JobMatchLabel` — following `JobListEntry` and `JobDateFields` rather than the bare `CONTESTED_FIELDS` style.
- **Criterion 50 is tested by reading `lib/job-merge.ts` as text** and matching the three signatures, since parameter names are not visible at runtime. `prisma/schema.test.ts` already establishes reading a file in a test.
- **`lib/job-label.ts` was extracted rather than copied.** Task 10 needed the label helper that lived privately in `lib/save-warnings.ts`. Copying breaks the DRY rule; importing it from `save-warnings` would make dedupe depend on save for no reason. The cost is that `lib/save-warnings.ts` changed, outside task 10's file list.
- **The fold's algorithm was replaced after measurement**, not taken from either writer. See the open threads.

### Gotchas found this session

- **The review rubric has no efficiency criterion.** `~/.claude/references/rubrics/code-quality-criteria.md` covers correctness, security, conventions, testing and minimalism. Two independent Opus writers both produced a fold that restarts the whole pairwise sweep after every merge, and both passed the rubric clean. It was caught only by benchmarking on a hunch.
- **Measured, the writers' fold was cubic.** 100 jobs 45 ms, 200 jobs 274 ms, 373 jobs 1,740 ms, and 1,853 jobs did not finish inside two minutes. The replacement carries each entry against the survivors gathered so far: 8 ms, 47 ms, and 1,140 ms, with 4,000 jobs at 5,337 ms. Survivor and fold counts are identical at every size measured — 81/19 at 100 and 299/74 at 373 — and the same 20 tests pass. The benchmark script lives in the session scratchpad and is not committed.
- **A test of mine was wrong, not the code.** It asserted both folds of a three-job chain name the final survivor. They do not: with three unsaved entries of equal rank each fold hands the id to the later side, so the surviving id moves along the chain and fold one names `b` while fold two names `c`. That is exactly what criterion 82 requires, and the test now asserts the immediate partner.
- **A single-member tagged union does not narrow to `never` on the `default` branch.** `DedupeWarning` has one kind, so `const exhaustive: never = warning` fails to compile while `= warning.kind` succeeds. Vitest passed either way; `npm run lint` caught it, which is the reason that script runs `tsc` after ESLint.
- **Task 8 superseded a passing test.** `lib/job-merge.test.ts` asserted the merge writes neither row timestamp. `created_at` is now carried in memory, so that test narrowed to `modified_at` alone.

### Approaches refused, so they do not come back

- **Reading the stored match-key columns in the identity clauses.** A collected entry has not been written, so it holds no key.
- **`Exclude<>` for the match-label type.** It subtracts rather than lists, so a new dedupe reason would join the label type unnoticed.
- **Copying `labelJob` into the dedupe warnings module**, and exporting it from `lib/save-warnings.ts` for dedupe to import. The first duplicates a rule, the second couples two steps through where a helper happened to land first.
- **Restarting the pairwise sweep after every fold.** Correct, and cubic — see above.

### Carried forward, still true

**`cat` is blocked on any file over 2048 bytes** by a hook — use `sed -n 'START,ENDp'` or the Read tool. **The commit hook prints a graph analysis block** on every commit; harmless. **It also flags private helpers as untested** even where tests cover them through the module's public function — it flagged all five of `lib/job-identity.ts`'s helpers. **`grep -r --include=*.ts` fails in this shell** — quote it as `--include="*.ts"`. **`timeout` is not on PATH** — use the Bash tool's own timeout parameter. **Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **Vitest output carries ANSI codes** — strip with `sed -e 's/\x1b\[[0-9;]*m//g'`. **`npx tsx -e` cannot run top-level `await`.** **`PIPESTATUS` does not survive** — use `cmd > file 2>&1; echo $?`. **`npm run lint` runs ESLint and then `npx tsc --noEmit`**, and ESLint runs with no `--max-warnings`, so a warning passes and a type error does not.

**A `crowd-code-writer` returns `<` and `>` HTML-escaped.** Convert them back before applying a snippet.

**Any task deriving a value after a merge needs the prompt to say which side to read from.** Spelled out for task 8's `created_at`, and both writers got it right.

**After editing `prisma/schema.prisma`, run `npx prisma format` and then `npx prisma generate`,** then `npm run db:create` and `npm run db:seed`.

**Anything new under `lib/steps/` loads two rules** — `.claude/rules/pipeline-steps.md` and `.claude/rules/naming.md`. **Task 11 is the first task this phase to land there.** **Anything touching `lib/collectors/registry.ts` loads a third**, `.claude/rules/source-registry.md`. **Editing any file under `.claude/rules/` goes through the `writing-rules` skill.** **A `BACKLOG.md` change needs the user's approval before it is written.**

**Every message to the user over one paragraph ends with a one-sentence TL;DR.**

### Open threads

1. **The fold's algorithm is not signed off.** The code standing in `lib/job-dedupe.ts` is the replacement, not the crowd-code output. The user deferred the choice to next session. Numbers are in the gotchas above.
2. **Whether `lib/job-label.ts` earns a decision-log entry.** The user said "this is how we should be working, extracted util?" — read as either an endorsement or a request to explain. It was explained and the question was left unanswered, so nothing was logged.
3. **Whether the code-quality rubric gains an efficiency line.** Two options were put up and deferred: a single line in `~/.claude/references/rubrics/code-quality-criteria.md` asking whether the work scales to real input, or a measurement step in `crowd-code` for changes that loop over a collection. The recommendation was the rubric line alone.
4. **The contested-link guard test is missing from `lib/job-service.test.ts`.** The fake has it and the real service does not. Offered twice across two sessions, never answered.
5. **`DEDUPE_REASONS` and the `Trace` comment can drift apart** with nothing complaining.
6. **The `company_id` and `title` index belongs to no spec task.** Fix at the phase close, or add it to task 11's file list.
7. **`tableIndexes` in `prisma/schema.test.ts` has no test of its own.** Offered, never answered.
8. **There are now three "the merge does not settle this" groups** — `NEVER_WRITTEN_FIELDS`, `DERIVED_AT_WRITE_FIELDS` and `STRIPPED_AT_WRITE_FIELDS`. Whether three is right, or two would do, is still a question nobody has asked.
9. **The writer-skipping decision is rule-shaped** and belongs as an edit to `crowd-code`'s SKILL.md. Raise it at the phase close.
10. **Whether Phase 11a wants a database reset of its own.** In the phase 11a r&d.
11. **Phase 6 planning ran across several sessions and only the last has meeting notes.**

## Next Steps

1. **Commit the nine uncommitted files.** Tasks 8, 9 and 10 plus the `docs/CURRENT-FEATURE.md` ticks and the `lib/job-label.ts` extraction. Separate goals, so separate commits.

2. **Settle open threads 1 to 3 with the user.** All three were deferred from this session's close and each is a small yes-or-no.

3. **Task 11 is the step, `lib/steps/dedupe.ts` and `lib/steps/dedupe.test.ts`.** Compare the list against itself through `foldMatchingJobs`, then look each survivor up by all three clauses, ignoring every id already on the list, folding one row or several, and leaving an entry alone and warning where the lookup threw. Criteria 59 to 71. It is the first task this phase under `lib/steps/`, so it loads the pipeline-steps and naming rules, and the first to reach a database.

4. **Then tasks 12 through 15 in order.**

5. **Close phase 6 when the build is done** — architecture doc, decision log, and any `BACKLOG.md` change presented for approval. That is its own checkbox in `docs/CURRENT-FEATURE.md`.
