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

**Phase 5, DB Save, is eight of sixteen tasks built.** Four of fourteen phases are closed. Tasks 1 through 8 are done, green, and pushed.

**The exact resume point: Phase 5 task 9, the delete warning** — `lib/save-warnings.ts` and its test. Criteria 53 and 54: a delete the guard refused produces one warning line naming both rows, never a count. It follows `lib/association-warnings.ts`, which deliberately does not fold, rather than `lib/normalization-warnings.ts`, which does.

**Four commits pushed, ending at `a344787`.** Two documentation files are modified and uncommitted: `docs/features/unified-pipeline/decision-log.md` and `docs/features/unified-pipeline/phases/phase-05-db-save-spec.md`. Both are this session's close-out writing. No code file is uncommitted.

**Verified at close, run fresh.** `npm run test` exits 0 with **1,447 tests across 52 files**. `npm run lint` exits 0 with no warnings, which runs ESLint then `tsc --noEmit`.

## Completed This Session

Four commits, oldest first:

| Commit | What |
|---|---|
| `2735c55` | The previous session's close-out docs, committed |
| `a327a63` | Task 7 — the job service |
| `51c64d8` | Task 8 — the service's fake |
| `a344787` | Ticking tasks 7 and 8, and naming the fake's test in both task lists |

**Task 7 produced `lib/job-service.ts` and `lib/job-service.test.ts`**, 141 lines and 13 tests. Its shape:

```ts
export type JobWriteOutcome = "created" | "updated" | "status_updated" | "unchanged";
export interface UpdateResult { job: JobListEntry; outcome: JobWriteOutcome }
export interface DeleteResult { deleted: boolean; blockedBy: JobListEntry | null }
export interface JobService {
  update(entry: JobListEntry, priorityList: readonly string[]): Promise<UpdateResult>;
  delete(id: string): Promise<DeleteResult>;
}
export function createJobService(db: PipelineDb): JobService
```

**Task 8 produced `lib/job-service.fake.ts` and `lib/job-service.fake.test.ts`**, 74 lines and 15 tests. `fakeJobService(jobs, overrides)` mutates the caller's array, like `fakeCompanyService`.

## Decisions & Context

**The decision log is the authority for what was settled.** One entry was appended, dated 2026-09-06. Eleven calls went into the Phase 5 spec under "Calls made while building", which now runs to 35 bullets. What follows is only what is not written down elsewhere.

### The decision the user made

- **The job service takes the priority list as an argument to `update`**, not from construction. Every service is built from the database client alone, and reading settings needs an `await` the constructors do not have.

### Gotchas found this session

- **Prisma quotes your own source lines inside its error messages.** A test asserting `rejects.toThrow(/requires entry\.id/)` passed with the guard deleted, because the `throw` line itself sat in Prisma's quoted context. Both guard tests now check `error.name` as well. **Every test in this project asserting only on an error message has the same hole.**
- **A fake's override test must return an answer the fake could never produce.** Mine returned "nothing was deleted" against an empty array, which is what the fake's own `delete` returns anyway, so removing override support left it green.
- **Both `crowd-code` writers used `if (entry.status)` where the real service uses `!== undefined`.** Expect it again on the next fake.
- **`@typescript-eslint/no-unused-vars` only ignores `_`-prefixed function arguments here, not destructured ones.** `const { id: _id, ...rest }` warns. Use `delete` on a copy instead.
- **The commit hook still reports false test gaps** — it named `createJobService`, `toJobListEntry`, `toColumnData`, `fakeJobService` and others as untested. All are covered.

### Open questions

1. **A merged row can name a parser that never parsed it.** Settle in Phase 8. Recorded in the Phase 5 spec.
2. **Whether to rebuild the live pipeline database.** Still the old schema, 21 companies, 1 setting, 0 jobs, 0 traces. Rebuilding is `npm run db:create` then `npm run db:seed`. Nothing needs it until a task writes a job — which task 12 is. **The user has been asked three times and has not answered.**
3. **A renamed collector leaves an orphan entry in the priority list.** The seed never removes. In the Phase 5 r&d, unagreed.
4. **Whether Phase 11a wants a database reset of its own.** In the Phase 11a r&d.

### Carried forward, still true

**The seed does not yet write `source_priority_list`** — that is task 11. So the settings service's happy-path tests write the value with raw SQL, and nothing yet proves the seed fills it.

**In the create race, if the row cannot be read back the merge runs against an empty stored side.** The arriving entry's fields win and the rest are absent from the write, which Prisma leaves alone. Commented in place. Nothing in normal running reaches it.

**`npx tsx` cannot run a script with top-level `await`.** It needs a `main()` wrapper, the way `scripts/db-seed.ts` does. **`npx prisma db push` prints help text** instead of a clear error when handed a flag it does not want; run it bare. **The shell's folder position carries between Bash calls**, so a `cd` breaks the next call's relative paths. **`PIPELINE_DATABASE_URL` set in the environment beats `.env`**, because dotenv never overwrites an already-set variable — that is what makes probing a scratch database safe. **`npm run db:create` is the destructive command**, not `db:seed`.

**`lib/trace-proof.test.ts` asserts exact trace-row totals**, so every count shifts once save writes a row per job, and `post_collection_save` joins its sorted step list. That is **task 13**.

**Task 12 is the big one.** Wiring save into the orchestrator adds required options to `runCollection`, and 73 call sites follow.

**Anything new under `lib/steps/` loads the step contract** in `.claude/rules/pipeline-steps.md`. **A `BACKLOG.md` change needs the user's approval before it is written.**

**Save runs before dedupe exists**, so until Phase 6 two runs of `npm run collect` write two rows for one posting. Expected and short-lived.

**Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **`cat` is blocked on any file over 2048 bytes** by a hook. **A trace detail is a Json column**, so a stored string reads back with its quotes. **Vitest output carries ANSI codes** — strip them with `sed -e 's/\x1b\[[0-9;]*m//g'` before grepping it.

**Zero of the modules in `lib/` use JSDoc comment blocks** — all use `//`. Both `crowd-code` writers reach for JSDoc every time and it has to be converted.

### How the build loop ran

Every task: write the test file first, run it red, dispatch two `crowd-code-writer` sub-agents in parallel at Sonnet tier, pick or combine, apply, go green, then break the code deliberately several ways and confirm every test catches its own break.

Break counts: 13 for `job-service` covering all 13 tests, 13 for `job-service.fake` covering all 15. Two of those breaks found weak tests rather than weak code, and both tests were rewritten.

## Next Steps

1. **Commit the two uncommitted documentation files** if this session did not — `decision-log.md` and `phase-05-db-save-spec.md`.

2. **Build task 9, the delete warning.** `lib/save-warnings.ts` and its test. Criteria 53 and 54: a delete refused by the active guard warns with one line per pair, never a count. Follow `lib/association-warnings.ts` — a tagged union of warning kinds, an exhaustiveness check in the `switch`, and a `labelCompany`-style helper for naming a row the user has to go and look at. The job service already hands back the blocking row as `blockedBy`, so the warning has both rows to name.

3. **Then task 10, the step.** `lib/steps/save-jobs.ts` and its test. Load `.claude/rules/pipeline-steps.md` first.

4. **Work the remaining tasks in order**, 9 through 16, from [`phase-05-db-save-spec.md`](../docs/features/unified-pipeline/phases/phase-05-db-save-spec.md#tasks). They are also in `docs/CURRENT-FEATURE.md` under the build item.

5. **Close phase 5** after building — architecture doc, decision log, and any backlog change presented for approval. Then take the 16 tasks back out of `CURRENT-FEATURE.md`, leaving one line linking to the spec.
