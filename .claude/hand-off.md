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

Feature: **Unified Job Pipeline** — one feature, twelve phases, on the long-lived branch `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 1 (Collection) is building. Tasks 1 through 5 of 14 are done; 9 remain.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **task 6, the search-term analyzer**.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md` — now 76 acceptance criteria and 14 ordered tasks. Read it with `phase-01-collection-r&d.md` beside it.

Working tree is clean. Everything is committed and pushed through `1f40819`.

The pipeline database exists at `pipeline.db`, created and seeded: one `Setting` row and 21 companies (13 Greenhouse, 3 Lever, 5 Ashby).

## Completed This Session

**The `.env` trap, closed at its source.** `lib/pipeline-db.ts` imports `dotenv/config`, so every collector, service, and script reaching the database gets `PIPELINE_DATABASE_URL` without loading `.env` itself. It sits there rather than in `lib/pipeline-env.ts` because that module exists to be testable with the variable unset.

**Task 4 — settings service.** `lib/settings-service.ts` exposes `createSettingsService(db)`, returning five getters and nothing else. 25 tests cover AC 9–11 and 75.

**Task 5 — job list entry type.** `lib/job-list-entry.ts` exposes `JobListEntry`, derived from the generated `Job` model, and `JOB_LIST_ENTRY_FIELDS`, the same fields at runtime. 5 tests cover AC 26.

**The spec gained AC 75 and AC 76**, both appended rather than inserted, because inserting shifts every number after it and silently breaks the Tasks list and the Edge Cases table.

Verified at each commit, all exit 0 — `npm run test` 115/115 across 5 files, `npm run lint`, `tsc --noEmit`, and `prisma validate`. `dev.db` was not touched.

**Both new guards were proven by breaking them.** Removing `import "dotenv/config"` from `lib/pipeline-db.ts` fails the AC 75 test. Removing `salary_raw` from `JOB_LIST_ENTRY_FIELDS` fails the AC 26 test and names that field.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. Three were added this session, covering where `.env` loads, the empty ATS platform answer, and deriving the job list entry type.

**Settings service shape:**

- `createSettingsService(db)` takes a client rather than building one, so the caller owns the connection and closes it. The orchestrator will build one client and pass it down.
- The returned object is a plain literal with exactly five keys. That is what makes AC 10 testable — the test reads `Object.keys(service)`.
- A missing setting throws and names the column. An ATS platform with no companies returns an empty list.

**Constraints, all measured:**

- **`npx tsx -e "<code>"` can `require()` a TypeScript module under `lib/`** when run from the repo root. That is how the AC 75 test runs the service the way a collector will, in a process that never receives `PIPELINE_DATABASE_URL`.
- **`as const satisfies readonly (keyof JobListEntry)[]` compiles here.** It rejects a name that is not a field of the type, but it does not catch a field left off the list — the `PRAGMA table_info(Job)` test does that.
- **The generated `Job` model type excludes the `company` relation**, so `Partial<Job>` is already exactly the 18 columns.
- **ESLint config is `.eslintrc.json`, not a flat config**, and `no-unused-vars` is a warning, so warnings do not fail `npm run lint`.
- **A `Json` column read back through raw libsql is a JSON text string**, not an array, which tests must `JSON.parse`.

**Approaches tried and dropped:**

- **Putting `import "dotenv/config"` in `lib/pipeline-env.ts`.** That module exists so a test can unset the variable and reach the throw; loading `.env` there puts the variable straight back.
- **Throwing when an ATS platform has no companies.** Built that way first and changed. Emptying a platform's companies is how that platform is switched off, so an empty list is a real answer rather than a broken database. AC 76 covers the warning that replaces the noise the throw used to make.

**Working with the writer agents.** Two per chunk, tests first and implementation second, with the failing test run in between. On the small type module both outputs were nearly identical; on the test files they diverged enough that combining halves was worth the read.

## Next Steps

1. **Task 6 — search-term analyzer.** Install `stemmer` first; it is still not a dependency and would be the project's first text-processing one. Tokenise, lowercase, stem, pass tokens under three characters through unstemmed, and match token to token with every term word present. Tested against the measured `dev.db` titles. — AC 38–45
2. **Task 7 — date util.** Ported from `parse-age`, taking the expiry threshold as an argument rather than hardcoding eight. — AC 49–51, 70
3. **Task 8 — collector interface and orchestrator.** One shape for every collector, a limit argument, per-collector catch, errors and warnings returned, per-collector logging, and a warning when an ATS platform has no boards to poll. — AC 14–16, 18, 20–25, 76
4. Tasks 9 through 14 follow in the spec's order, which puts the working collectors before weLoveProduct and Ashby.
5. Each task is built test-first. Invoke `test-driven-development` before writing implementation code — the acceptance criteria are the test list.
