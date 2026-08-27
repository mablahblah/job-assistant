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

**Phase 1 (Collection) is building. Tasks 1, 2 and 3 of 14 are done; 11 remain.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **task 4, the settings service**.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md` — now 74 acceptance criteria and 14 ordered tasks. Read it with `phase-01-collection-r&d.md` beside it.

Working tree is clean. Everything is committed and pushed through `5ce2029`.

The pipeline database exists at `pipeline.db`, created and seeded: one `Setting` row and 21 companies (13 Greenhouse, 3 Lever, 5 Ashby).

## Completed This Session

**Task 2 — schema and create command.** `prisma/schema.prisma` gained `Job` (18 columns), `Company`, and `Setting`. `scripts/db-create.ts` deletes the database file and pushes the schema. 33 tests cover AC 4, 5, 17, 26, 74.

**Task 3 — seed script.** `scripts/db-seed.ts` fills absent settings and creates a company per ATS slug, overwriting nothing. `lib/pipeline-db.ts` builds the Prisma client. 43 tests cover AC 6, 7, 8, 12, 13.

**Two things beyond the tasks.** `pipeline-env.ts` moved to `lib/`, now that `lib/` is the decided home. `postinstall` runs `prisma generate`, because a fresh clone had no client at all.

Verified at each commit, all exit 0 — `npm run test` 85/85 across 3 files, `npm run lint`, `tsc --noEmit`, `prisma validate`, and `dev.db` matching its pre-work checksum.

**A bug the criteria could not catch.** Every test handed the database url to the command directly, so all 32 passed while `npm run db:create` was broken for a real run — the script never loaded `.env`. Found only by running the real command. AC 74 now covers it, along with an edge-case row.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. Seven were added this session, covering the source root, the settings table shape, the create command, client generation, the location and radius values, and the seeded company name.

**Prisma constraints, all measured:**

- **`--force-reset` is unusable.** Prisma refuses it to any command it detects as AI-run unless handed `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` carrying the user's exact words. Deleting the file first reaches the same empty database with no flag.
- **`--skip-generate` is not a valid flag** for `db push`. It prints the help text and exits 0 without creating anything — a silent no-op that makes tests pass against an empty database.
- **`db push` does not generate the client.** After a schema change, run `npx prisma generate` or the client still describes the old schema.
- **Tables are PascalCase** from the model names, with no `@@map`. The snake_case ruling is satisfied at field level.
- **`modified_at DateTime @updatedAt` is NOT NULL with no SQL default.** Any "nothing is required without a default" assertion must exempt `id`, `created_at`, and `modified_at`.
- **A relative Prisma url resolves from the `prisma.config.ts` directory**, not the working directory. Tests must pass absolute urls.

**Runtime and typing gotchas:**

- **No top-level await.** `package.json` has no `"type": "module"`, so tsx runs scripts as CommonJS and top-level await is a TransformError. Wrap in `async function main()`.
- **The adapter export is `PrismaLibSql`**, not `PrismaLibSQL`.
- **A `Json` column reads back differently by route** — an array through Prisma, a JSON text string through raw libsql, which tests must `JSON.parse`.
- **`tsconfig.json` excludes `generated/`, but importing the generated client still typechecks.**
- **`dotenv` never overwrites an already-set variable**, which is what lets a test point a child process at a scratch database while the real `pipeline.db` stays untouched.

**Working with the writer agents:**

- **One reported "File written: …" without having written anything.** Check the filesystem rather than trusting the claim.
- **Corrections queued to a finished agent never arrive**, and re-sending does not resume it. Send everything in the first prompt, or combine and correct the outputs yourself.

**Approaches tried and dropped:**

- **A key-value settings table.** It forces a generic `value` column holding a list, a string and two numbers, which stretches `Json` past the list fields it is reserved for.
- **Folding `prisma generate` into `db:create`.** The generator's output path is fixed in the schema, so the test suite would rewrite the one shared client while parallel tests import it. Decided by three independent agents, two to one.

## Next Steps

1. **Close the AC 74 trap before writing task 4.** The settings service reads configuration, which is exactly the shape that shipped broken this session: every test supplied the database directly, so the suite passed while the real command failed. Task 4's tests must include one that runs the service the way the pipeline will — url coming from `.env`, absent from the environment — and tasks 3 and 4's scripts each already carry such a test to copy from.
2. **Task 4 — settings service.** Reads only, no create, update or delete. Throws on a missing setting rather than returning an empty default. Returns the companies carrying a given platform and slug, so a collector asks for its slug list rather than knowing how slugs are stored. Lives in `lib/`, test beside it. — AC 9–11
3. **Task 5 — job list entry type.** Maps one to one onto the Job row with `delete_on_save` the only extra. The Job columns are already fixed by the schema and asserted in `prisma/schema.test.ts`. — AC 26
4. **Task 6 — search-term analyzer.** Install `stemmer` first; it is still not a dependency and would be the project's first text-processing one. — AC 38–45
5. Tasks 7 through 14 follow in the spec's order, which puts the working collectors before weLoveProduct and Ashby.
6. Each task is built test-first. Invoke `test-driven-development` before writing implementation code — the acceptance criteria are the test list.
