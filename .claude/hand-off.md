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

**Phase 5, DB Save, is six of sixteen tasks built.** Four of fourteen phases are closed. Tasks 1 through 6 are done, green, and pushed.

**The exact resume point: Phase 5 task 7, the job service** — `lib/job-service.ts` and its test. Create with an explicit id, update, delete, the active guard, and a refused create reported back. It follows `lib/company-service.ts`: takes the caller's database client, hands back a small object, and reports a refused write by handing back a small answer rather than throwing.

**Phase 5's task numbers changed this session.** A task is now one unit of code together with its tests, so three build/test pairs merged and the merge's completeness check folded into the merge's own task. Twenty tasks became sixteen. **Every number after 1 has shifted.** The previous hand-off's "task 15 and 16 are the big ones" is now **task 12**. Its "task 20, the company service" is now **task 16**.

**Eight commits pushed, ending at `08f7f5f`.** Two documentation files are modified and uncommitted: `docs/features/unified-pipeline/decision-log.md` and `docs/features/unified-pipeline/phases/phase-05-db-save-spec.md`. Both are this session's close-out writing. No code file is uncommitted.

**Verified at close, run fresh.** `npm run test` exits 0 with **1,419 tests across 50 files**. `npm run lint` exits 0, which runs ESLint then `tsc --noEmit`.

## Completed This Session

Eight commits, oldest first:

| Commit | What |
|---|---|
| `e8205c1` | The previous session's Phase 5 planning docs, committed |
| `3aceadb` | The rule that a task is code plus the tests covering it |
| `0bd2721` | Task 1 — the schema columns and trace vocabulary |
| `8549698` | Task 2 — the active job statuses |
| `941f22a` | Task 3 — pooling a job's posting dates |
| `ea3f5b9` | Task 4 — ranking a job's sources |
| `0655e7b` | Task 5 — reading the priority list through settings |
| `08f7f5f` | Task 6 — the merge |

**What each task produced.**

1. `prisma/schema.prisma` + `prisma/schema.test.ts` — `Job.collected_at` as a required date with no default, `Job.parser` as an optional string, `Setting.source_priority_list` as a nullable Json column, save's four new trace events plus the reason `db_write_failed` in the `Trace` comment, and all twelve statuses in the `Job.status` comment. `lib/job-list-entry.ts` gained the two field names.
2. `lib/job-status.ts` — `ACTIVE_STATUSES` and `isActiveStatus(status: string): boolean`.
3. `lib/job-dates.ts` — `poolJobDates(one, two, collectedAt)` returning `{ posting_date, posting_updated_date }`.
4. `lib/source-priority.ts` — `parsePriorityEntry(entry)` and `sideRank(list, side): number | null`.
5. `lib/settings-service.ts` — `getSourcePriorityList()`, a tenth getter, with `isSourcePriorityList` reusing `parsePriorityEntry`. The fake gained it too.
6. `lib/job-merge.ts` — `mergeJobs(existing, arriving, priorityList, collectedAt)` plus six exported field-group constants: `CONTESTED_FIELDS`, `WRITTEN_THROUGH_FIELDS`, `WINNER_STAMP_FIELDS`, `WRITE_ONCE_FIELDS`, `POOLED_DATE_FIELDS`, `NEVER_WRITTEN_FIELDS`.

**Documentation.** The Phase 5 spec gained a "Calls made while building" section under Approach, 24 bullets, following Phase 4's precedent. Acceptance criteria 31 and 39 were superseded in place, dated, per the feature-specs rule.

## Decisions & Context

**The decision log is the authority for what was settled.** Two entries were appended, both dated 2026-09-06. What follows is only what is not written down elsewhere.

### Decisions the user made

- **A task is one unit of code together with the tests covering it**, never a build task followed by a test task. `crowd-code` writes the failing test and the code answering it in one invocation, so a split leaves the build task with no test to go red. The rule went into `phase-planning-procedure.md` step 4.
- **The merge settles the dates as well as the ranked fields**, taking the collection date as a fourth argument. Dedupe collapses two in-list entries through the same merge, so leaving the dates to save would put a second copy of the pooling rule where the merge exists to prevent one.

### Calls made while building

All 24 are written into the Phase 5 spec under "Calls made while building". The ones most likely to matter next:

- The priority list column is `source_priority_list`. Nothing had named it.
- `sideRank` returns `number | null`, not a sentinel. A side absent from the list must be told apart from one ranking last.
- The settings service throws on an empty priority list, following the title vocabularies rather than `search_terms`.
- The merge treats an empty string as empty, alongside null and an empty list.
- `collected_at` has its own allowance in the schema tests, `ORCHESTRATOR_WRITTEN_COLUMNS`, because it fits neither the database-written nor the collector-written group.

### Gotchas found this session

- **The commit hook reports false test gaps.** It printed "untested: fakeSettings, isSourcePriorityList, createSettingsService, getSourcePriorityList". The knowledge graph wants a test file named per function; those are covered by `lib/settings-service.test.ts`.
- **An `Edit` to a `CURRENT-FEATURE.md` checkbox silently did not reach disk once**, at task 3, despite reporting success. Re-applied with `perl` and confirmed in the commit diff. Re-check a checkbox that looks wrong.
- **Zero of the 23 modules in `lib/` use JSDoc comment blocks** — all use `//`. Both `crowd-code` writers reach for JSDoc every time and it has to be converted.
- **`npx prisma format` changed nothing** against the finished schema, so the layout already matches Prisma's own.
- **`prisma/schema.test.ts` already uses Phase 1's numbering** for `AC4`, `AC5`, `AC17` and `AC26`, so new blocks there are named for behavior instead.
- **A raw SQL insert into `Job` must supply `collected_at`**, the same way `Company` needs `modified_at`.
- **Vitest's `toEqual` ignores `undefined`-valued keys**, so a merged `raw_salary` carrying `salary_max: undefined` still passes — but `result.raw_salary ?? null` does not read as null for `{}`, so an all-empty salary must come out `undefined`.
- **Assigning `undefined` to a key still creates the property.** That is why the merge builds its result key by key rather than spreading either entry.

### Open questions

1. **A merged row can name a parser that never parsed it.** The row records the winning side by stamping its collector and parser. Where the winner has no parser and the loser does, the merged entry carries none, and a database update leaves the stored parser standing. Under-writing beats over-writing, and it cannot arise with the list as seeded because every parser outranks the collector beside it. **Settle in Phase 8**, where parsers exist. Recorded in the Phase 5 spec.
2. **Whether to rebuild the live pipeline database.** It still has the old schema and holds 21 companies, 1 setting, 0 jobs, 0 traces. Rebuilding is `npm run db:create` then `npm run db:seed`. Nothing needs it until a task writes a job. **The user was asked twice and has not answered.**
3. **A renamed collector leaves an orphan entry in the priority list.** The seed never removes. In the Phase 5 r&d, unagreed.
4. **Whether Phase 11a wants a database reset of its own.** In the Phase 11a r&d.

### Carried forward, still true

**The seed does not yet write `source_priority_list`** — that is task 11. So the settings service's happy-path tests write the value with raw SQL, and nothing yet proves the seed fills it.

**`npx tsx` cannot run a script with top-level `await`.** It needs a `main()` wrapper, the way `scripts/db-seed.ts` does. **`npx prisma db push` prints help text** instead of a clear error when handed a flag it does not want; run it bare. **The shell's folder position carries between Bash calls**, so a `cd` breaks the next call's relative paths. **`PIPELINE_DATABASE_URL` set in the environment beats `.env`**, because dotenv never overwrites an already-set variable — that is what makes probing a scratch database safe. **`npm run db:create` is the destructive command**, not `db:seed`.

**`lib/trace-proof.test.ts` asserts exact trace-row totals**, so every count shifts once save writes a row per job, and `post_collection_save` joins its sorted step list. That is **task 13**.

**Task 12 is the big one.** Wiring save into the orchestrator adds required options to `runCollection`, and 78 call sites follow.

**Anything new under `lib/steps/` loads the step contract** in `.claude/rules/pipeline-steps.md`. **A `BACKLOG.md` change needs the user's approval before it is written.**

**Save runs before dedupe exists**, so until Phase 6 two runs of `npm run collect` write two rows for one posting. Expected and short-lived.

**Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **`cat` is blocked on any file over 2048 bytes** by a hook. **A trace detail is a Json column**, so a stored string reads back with its quotes.

### How the build loop ran

Every task: write the test file first, run it red, dispatch two `crowd-code-writer` sub-agents in parallel, pick or combine, apply, go green, then break the code deliberately several ways and confirm every test catches its own break.

Break counts: 3 for `job-status` covering all 14 tests, 7 for `job-dates` covering all 16, 12 for `source-priority` covering all 22, 6 for the settings service covering all 12 new tests, and 18 for `job-merge` covering all 43. Sonnet tier for tasks 1 to 5, Opus for task 6, because the merge rules are intricate enough that a wrong answer would pass review.

## Next Steps

1. **Commit the two uncommitted documentation files** if the previous session did not — `decision-log.md` and `phase-05-db-save-spec.md`.

2. **Build task 7, the job service.** `lib/job-service.ts` and its test. Criteria 45 to 50 in the spec: an entry carrying an id no row holds creates that row with that id; a partial entry naming only an id and one field changes only that field; a create the database refuses because a row took that id between the check and the write updates that row instead; the service takes the caller's database client the way `createCompanyService` does; a row holding an active status takes a new status and nothing else.

3. **Then task 8, the service's fake**, following `lib/company-service.fake.ts`.

4. **Work the remaining tasks in order**, 7 through 16, from [`phase-05-db-save-spec.md`](../docs/features/unified-pipeline/phases/phase-05-db-save-spec.md#tasks). They are also in `docs/CURRENT-FEATURE.md` under the build item.

5. **Close phase 5** after building — architecture doc, decision log, and any backlog change presented for approval. Then take the 16 tasks back out of `CURRENT-FEATURE.md`, leaving one line linking to the spec.
