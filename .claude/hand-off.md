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

**Phase 5, DB Save, is planned and ready to build.** Four of fourteen phases are built and closed. No code was written this session — it was the back half of planning.

**The exact resume point.** [`phase-planning-procedure.md`](../docs/features/unified-pipeline/phase-planning-procedure.md) **step 8**, hand off to build. Steps 1 through 7 are all done: brain dump, orientation, discovery, the spec, `spec-review`, tracking, and `wrap-up-planning`. Next is **Build phase 5, task 1, the schema.**

**Nothing is committed.** Fourteen documentation files are modified or new and the working tree is dirty. No code file was touched, so the suite is unaffected — **1,300 tests across 46 files pass**, and `npm run lint` exits 0, which runs `tsc --noEmit` after ESLint. Both were run at the close of this session.

| File | What changed |
|---|---|
| `docs/features/unified-pipeline/phases/phase-05-db-save-spec.md` | **New.** 78 acceptance criteria, 20 tasks, the regression net, 11 edge cases |
| `docs/features/unified-pipeline/phases/phase-11a-trace-cleanup-r&d.md` | **New.** A phase inserted this session |
| `docs/features/unified-pipeline/meeting-notes/2026-09-06-phase-05-db-save-meeting-notes.md` | **New.** This session's record |
| `docs/features/unified-pipeline/decision-log.md` | 20 entries added, 4 superseded |
| `docs/features/unified-pipeline/feature_spec.md` | 15 stories added, 3 rewritten, the phases table gained 11a |
| `docs/CURRENT-FEATURE.md` | Plan phase 5 checked off, its 20 tasks added, phase 11a added |
| `docs/features/unified-pipeline/db-entries.md` | `collected_at` row added, three rows corrected |
| `docs/features/unified-pipeline/architecture.md` | One line corrected — parsers no longer always beat collectors |
| `phases/phase-05-db-save-r&d.md` | One question marked settled, one new one opened |
| `phases/phase-08-parsers-r&d.md` | Warned that every parser it builds lands below all seven collectors |
| `phases/phase-09-classification-r&d.md` | Carried forward from the previous session |
| `phases/phase-11-work-log-r&d.md` | The work log entry's shape, settled here |
| `phases/phase-12-cutover-r&d.md` | The reset script is deleted here |

## Completed This Session

**The three questions the last session left hanging**, all closed by the user. No warning for a source missing from the priority list. `collector:user` seeded at the top of that list. And `runCollection` keeps its name, because the run is still a collection.

**Six sub-agents across two rounds of stress testing.** Three hunted edge cases, three checked readiness. Sixteen findings survived being verified against the code.

**Two spikes run rather than argued**, against a scratch database at `/tmp`, since a question that a small experiment can settle should be measured.

**The spec, reviewed and approved.** `spec-review` found six things — four settleable from existing sources, two that needed the user.

**An alignment check that caught six drifts**, including a status list that undercounted by two and would have carried the mistake into the schema.

**A new phase, 11a — Clean up Trace events.** Inserted before cutover on the user's call.

## Decisions & Context

**The decision log is the authority for what was settled.** Twenty entries dated 2026-09-06 cover the priority list, the merge, the dates, the active guard, the work log, the job service, and the trace names. Four older entries were replaced. What follows is only what is not written down elsewhere.

**The shape Phase 5 builds, in one paragraph.** A job service owning every create, update and delete of `Job` one row at a time, plus a save step taking the job list and calling it — the same split as Phase 4's company service and association step. Every caller goes through one `update` taking a partial entry. A named field list decides each field's fate: contested fields run the priority contest, the rest write straight through, and an absent field changes nothing.

### Gotchas found this session

- **`npx tsx` cannot run a script with `await` at the top level.** It needs a `main()` wrapper, the way `scripts/db-seed.ts` does. Wasted a run before this was noticed.
- **`npx prisma db push` prints its help text instead of a clear error** when handed a flag it does not want. Run it bare, the way `scripts/db-create.ts` does.
- **The shell's folder position carries between Bash calls.** A `cd` in one command breaks every relative path in the next.
- **`PIPELINE_DATABASE_URL` set in the environment beats `.env`,** because dotenv never overwrites a variable already set. That is what makes probing a scratch database safe — export it, and every Prisma command follows it rather than the real file.
- **`prisma.config.ts` reads the url through `getPipelineDatabaseUrl()` and the schema names no database of its own.** Check that before running any Prisma command, or a push can land on the database real job searches depend on.

### Measured this session, not guessed

- **A caller-supplied `id` on `Job.create` is honoured.** Creating with `id: "known-id-123"` returns exactly that. Omitting it returns a generated 25-character id. This is the fact the whole "the collection-time id must survive into the row" story rests on, and it now holds under the libsql driver rather than only in theory.
- **An id collision throws `PrismaClientKnownRequestError` with code `P2002`.** `isUniqueConstraintError` at `lib/company-service.ts:57` already recognises it unchanged.
- **The clashing column IS readable off the error**, at `meta.driverAdapterError.cause.constraint.fields`. The comment at `lib/company-service.ts:54` says it is not. That is task 20 of this phase.
- **`runCollection` has 78 call sites** — 73 in `lib/steps/search-orchestrator.test.ts`, 4 in `lib/trace-proof.test.ts`, 1 in `scripts/collect.ts`. Phase 4's company service broke 70, so this is the same shape again.
- **No collector sets `status` on a job.** Checked across all seven. That is what makes "save writes the status the entry carries" safe.
- **No list of active statuses exists in the new code.** Legacy holds the same five twice, at `scripts/serve.ts:37` and `scripts/cli.ts:108`.

### Dropped on purpose — do not re-propose

- **A warning for a source missing from the priority list.** The seed adds every missing registry name on its own.
- **Placing a new registry name by kind.** It goes to the bottom whatever it is, and the user reorders by hand.
- **A second plain-write method on the job service.** The named field list already separates contested from uncontested, so the caller does not need to.
- **Per-field provenance.** Would need a column per field. The row records the winning side and the roughness is accepted.
- **Two new trace events**, for a job found active and left alone, and for a delete the guard refused. The user's words: "they dont tell us anything of value."
- **Validation against a typo in the priority list.** The user's words: "there wouldn't be typos."
- **A resolution path for a refused delete.** The duplicate is caught by a later run or left standing.

### Calls made this session, all approved by the user

The merge is a plain function over two entries with the priority list handed in. An empty list and a null both count as empty for the three list columns. The priority-list getter throws when missing, like every other setting. The seed prints what it appended. File names: `lib/job-dates.ts`, `lib/source-priority.ts`, `lib/job-merge.ts`, `lib/save-warnings.ts`, `lib/steps/save-jobs.ts`, `lib/job-service.fake.ts`. The reason code is `db_write_failed`.

### Open questions

1. **A renamed collector leaves an orphan in the priority list.** The seed never removes, so changing a collector's `name` appends the new spelling and leaves the old one there forever, silently. A warning would follow the slug-clash precedent but was not agreed. In the Phase 5 r&d.
2. **Whether Phase 11a wants a database reset of its own** to prove renamed events round-trip from empty. In the Phase 11a r&d.

### Carried forward, still true

**`lib/trace-proof.test.ts` asserts exact trace-row totals**, so every count in it shifts once save writes a row per job, and `post_collection_save` joins its sorted step list. Task 17.

**`npm run db:create` is the destructive command**, not `db:seed`. It deletes the database file and pushes the schema onto nothing. `npm run db:seed` fills what is absent, overwrites nothing, and is safe to re-run.

**A job cannot be collected in one run and saved in the next.** Collection, normalization, association and save all run back to back over one in-memory list.

**Save runs before dedupe exists**, so until Phase 6 two runs of `npm run collect` write two rows for one posting. Expected and short-lived.

**Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **`cat` is blocked on any file over 2048 bytes** by a hook, and a bare `sleep` is blocked too. **`lib/steps/search-orchestrator.test.ts` reads its own source file off disk** in one test. **Blanking a comment block in `schema.prisma` fails the comment tests for the wrong reason.** **`modified_at` has no database default**, so a raw SQL insert into `Company` must supply it. **A trace detail is a Json column**, so a stored string reads back with its quotes and needs `JSON.parse`.

**Still open from earlier phases.** Whether an ATS job id should join dedupe's identity clauses, for Phase 6. The collector survey's legal note about undocumented endpoints and terms of service. Three sources in that survey needing marking if built — Tech Ladies, Devex, Bullhorn. `docs/DECISIONS.md` does not exist yet, and the backlog approval decision sits in the feature log as a promotion candidate. `normalizeJobs` silently skips a job carrying no `id` or no `collector`. `level`, `role` and `team` are computed and thrown away. Criteria 93 and 96 wait on Phase 8. The two search issues live only on this branch until cutover.

**The database right now** holds 21 companies, 1 setting, 0 jobs, 0 traces.

## Next Steps

1. **Build phase 5, test-first**, working the 20 tasks in [`phase-05-db-save-spec.md`](../docs/features/unified-pipeline/phases/phase-05-db-save-spec.md#tasks) in order. They are also listed in `docs/CURRENT-FEATURE.md` under the build item.

2. **Task 1 is the schema** — `Job.collected_at` as a required date with no default, `Job.parser` as an optional string, the priority-list column on `Setting`, save's five events in the `Trace` comment, and all twelve statuses in the `Job.status` comment. **Run `npx prisma generate` after**, or the client keeps describing the old schema.

3. **Write the tests, run them against a deliberately wrong stub**, read which pass, strengthen any a do-nothing implementation satisfies, then dispatch `crowd-code`'s two writers. Where the task *is* tests, break the real code deliberately and confirm each test catches its own break.

4. **Anything new under `lib/steps/` loads the step contract** in `.claude/rules/pipeline-steps.md`.

5. **Task 15 and 16 are the big ones.** Wiring save into the orchestrator adds required options to `runCollection`, and 78 call sites follow.

6. **A `BACKLOG.md` change needs the user's approval before it is written.** Present it as a question.

7. **Close phase 5** after building — architecture doc, decision log, and any backlog change presented for approval. Then take the 20 tasks back out of `CURRENT-FEATURE.md`, leaving one line linking to the spec.
