# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Session Context** section for reasoning that isn't captured elsewhere. The decisions the user made are not in this document — read the feature decision log for those.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

**Phase 13, migration and switch over: tasks 1 through 11 of 15 are built and committed.** Each task landed test first as its own commit on `feature/unified-pipeline`. The working tree is clean. The suite was verified at session end: 155 files, 3,266 passed, 17 deliberately skipped. Lint and the type check pass.

Tasks 12 through 15 remain, unchecked in `docs/CURRENT-FEATURE.md`: the resume skill re-home, the run identifier, deleting `legacy/`, and the by-eye switch over, which needs the user present.

## Completed This Session

Eleven tasks. The rebuild command (`scripts/db-create.ts`) takes an explicit target and always refuses the file `.env` names. Six recovery messages advise `npm run db:migrate` instead of the wipe. `scripts/db-migrate.ts` is the schema-change command: dated copy first, baseline adoption, then `prisma migrate dev`; `prisma/migrations/0_init/` is the committed baseline. The seed creates no board rows. The reset script is deleted; `scripts/retired-commands.test.ts` proves its absence. `scripts/db-migrate-data.ts` is the one-time data migration — four refusals, no trace rows, live-count verification, and the three migrators: work log entries, employers, jobs. `find-jobs` gained `--json`. `lib/tools/rendered-page-fetcher.ts` ports the browser-driven fetch, with a fake beside it.

## Session Context

- **The pipeline.db incident.** Before the guard existed, the first run of the new guard tests rebuilt the real `pipeline.db`. It lost only test output from phases 1 through 12 — 313 jobs, 191 employers, trace rows — and the file is now an empty, unseeded schema. `dev.db` is untouched: 70 work log entries, 2,208 jobs. The switch over plan rebuilds `pipeline.db` from empty anyway. The tests were rewritten so a re-run can only wipe scratch files.
- **The migration command reads `DATABASE_URL` as its source** and `PIPELINE_DATABASE_URL` as its target, both the names `.env` already holds. It reads the old file raw with libsql and writes through the company, job, and work log services.
- **Migrated jobs keep their old ids.** Work log entries name jobs by id, and the work log page walks entry to job to employer.
- **The migration tests seed their target** (`makeDbs` runs `db-seed.ts`) because the job migrator reads the seeded source priority list through the settings service. The real runbook order is the same: rebuild, seed, migrate.
- **`db-create.ts` compares its argument against `.env` parsed directly**, never `process.env`, so a shell override cannot make a wipe of the real file look safe.
- **Prisma 7 removed `--skip-generate`.** Measured: `migrate dev` with nothing pending neither prompts nor regenerates the client, which is what makes it safe inside the suite.
- **Deviation from crowd-code:** pure deletions (seed boards, reset script) were edited directly rather than through writer tournaments — a deletion has no second spelling. Failing tests still came first everywhere.
- **An old schema test died deliberately:** the one proving `db-create` read its url from `.env`, retired by the named-target criterion. Two other tests flipped from expecting `db:create` advice to `db:migrate`.
- **Docs to correct at phase close:** `CLAUDE.md`'s command table still describes `db:create` without its target argument and does not list `db:migrate`; the architecture doc's claim that all three database commands retire is already flagged in the r&d file.

## Next Steps

1. **Task 12 — the resume skill re-homes.** New lookup syntax (`find-jobs --company X --json`), best-link fetch (resolved link, else collected), a tool-failure branch distinct from the dead-posting branch, dead branch closes with a message and no status write. Criteria proven by reading the skill file, per the spec's test-suite note.
2. **Task 13 — the run identifier prints and travels.** `scripts/job-search.ts:82` mints it; print it first, name it in the job-search skill's output contract, pass it to scoring, warn on a stranger identifier.
3. **Task 14 — delete `legacy/`** plus the `cli` npm entry, add the add-external-jobs skill note, keep the five location-research scripts, prove with lint and the suite.
4. **Task 15 — the switch over, by eye, with the user present:** rebuild once, seed, migrate, verify; read every migrated contact detail (one known placeholder address says "test"); generate one real resume end to end.
