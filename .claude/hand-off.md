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

Feature: **Unified Job Pipeline** — one feature, thirteen phases, on the long-lived branch `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 1 (Collection) is building. Task 1 of 14 is done; 13 remain.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **task 2, schema and create command**.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md` — 73 acceptance criteria and 14 ordered tasks. Read it with `phase-01-collection-r&d.md` beside it, which carries the brain dump, what planning settled, and everything measured during planning and during the build.

Working tree is clean. Everything is committed and pushed through `a6cf53f`.

## Completed This Session

**Task 1 — separate the database.** `prisma.config.ts` reads `PIPELINE_DATABASE_URL` and points at `prisma/schema.prisma`, so no Prisma command on this branch reaches the `dev.db` real job searches use. `pipeline-env.ts` holds the lookup and throws when the variable is missing. `prisma/schema.prisma` carries a generator and a sqlite datasource and no models. `prisma.config.test.ts` covers AC 1–3 in nine tests.

Built test-first: the test file was written first, then a stub that deliberately fell back to `DATABASE_URL`, which failed 7 of 9 tests. The real implementation took it to 9 of 9.

Verified at commit, all exit 0 — `npm run test` 9/9, `npm run lint`, `tsc --noEmit`, `prisma validate`, and `dev.db` matched its pre-work checksum.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. Not repeated here. Two were added this session, covering the generated-client output path and why the database URL lookup is its own module.

**The new pipeline has no source root.** The schema sits at `prisma/` and `pipeline-env.ts` sits at the repo root, the latter only because `prisma.config.ts` must live there and imports it. Neither is a convention. Tasks 4, 5 and 6 each need a home for their code, and choosing one per task scatters them.

Prerequisites the build still trips over:

- **`stemmer` is not installed.** AC 43 and task 6 name it; `package.json` has no text-processing dependency. It would be the project's first.

Working gotchas:

- **`pipeline.db` exists and holds no tables**, created while verifying task 1. AC 4 reads "given an empty directory", so task 2 deletes it and creates from scratch rather than pushing onto it.
- **The `dev.db` baseline checksum does not survive a session.** Take a fresh one before running anything that touches a database. It is `60e476eefc0c96d0836b96718d4332a1bf94570e7c85bd26fe216a2beee158b7` at 1,810,432 bytes as of `a6cf53f`.
- **`env -u PIPELINE_DATABASE_URL` does not test the missing-variable case.** `prisma.config.ts` imports `dotenv/config`, which reloads `.env` and restores the variable, so the command succeeds and reads as a pass. Verifying AC 2 needs `DOTENV_CONFIG_PATH` pointed at an empty file.
- **The `\bDATABASE_URL\b` guard in `prisma.config.test.ts` works because `_` is a regex word character**, so the pattern cannot match inside `PIPELINE_DATABASE_URL`. Rewriting it as a substring check breaks it.
- **A relative Prisma URL resolves from the `prisma.config.ts` directory**, not the schema directory, so `file:./pipeline.db` lands at the repo root. Measured.
- **The spec's criterion numbers are cross-referenced** by the Tasks list and the Edge Cases table. Inserting a criterion shifts everything after it and silently breaks those references.
- **Playwright diagnostics cannot run from the scratchpad.** `tsx` resolves `node_modules` from the script's location, so a diagnostic lives in the repo root. Use a dot-prefixed temp file and delete it after.

Approaches tried and dropped:

- **`(?<!PIPELINE_)DATABASE_URL`** as the guard against the old variable. It matches its own error message, which reads "the legacy `DATABASE_URL`", so the test fails on arrival.
- **Asserting on the config file's source text** to prove it reads the right variable. That passes against a config that reads `PIPELINE_DATABASE_URL` and then ignores it. The committed tests import the config and assert on the resolved object instead.

## Next Steps

1. **Settle where the new pipeline's source code lives**, before task 2 writes anything outside `prisma/`. Tasks 4, 5 and 6 need a home for the settings service, the job list entry type, and the analyzer. This is a decision for the user, and it belongs in the decision log once made.
2. **Task 2 — schema and create command.** The Job, Company, and settings tables collection needs. Every collector-written field nullable or defaulted; list fields as `Json`; snake_case names with no `@map`. The target shapes are in `docs/features/unified-pipeline/db-entries.md` under *Job — target* and *Company — target*. Delete `pipeline.db` first so the create command is tested from nothing, and take a `dev.db` checksum before starting. — AC 4–5, 17, 26
3. **Task 3 — seed script.** Fills what is absent, overwrites nothing. Search terms, location, radius, the expiry threshold, the 13 Greenhouse companies, and the Lever and Ashby test companies. — AC 6–8, 12–13
4. **Task 4 — settings service.** Reads only, throws on a missing setting. — AC 9–11
5. Tasks 5 through 14 follow in the spec's order, which puts the working collectors before weLoveProduct and Ashby.
6. Each task is built test-first. Invoke `test-driven-development` before writing implementation code — the acceptance criteria are the test list.
