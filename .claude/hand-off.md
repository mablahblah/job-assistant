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

**Phase 5, DB Save, is fifteen of sixteen tasks built.** Four of fourteen phases are closed. Tasks 1 through 15 are done and green.

**The exact resume point: Phase 5 task 16, the company service's conflict lookup.** Then close phase 5. Nothing else in the phase remains.

**One file is uncommitted:** `docs/features/unified-pipeline/phases/phase-05-db-save-spec.md`, six lines added to the "Calls made while building" list. Everything else is committed and pushed.

**Four commits pushed this session.**

| Commit | What |
|---|---|
| `af1b342` | Task 14 — the registry rule and its tick |
| `a426814` | A search-issues note, unrelated to this phase |
| `c82716b` | Task 15 — the reset script, its 6 tests, the `db:reset` entry |
| `182e6b4` | The seed's redundant `dotenv/config` import removed |

**Verified at close, run fresh.** `npm run test` exits 0 with **1,541 tests across 56 files**. `npm run lint` exits 0, which runs ESLint then `tsc --noEmit`.

## Completed This Session

Two tasks and one cleanup.

| What | Produced |
|---|---|
| Task 14 — the registry rule | `.claude/rules/source-registry.md`, 9 lines |
| Task 15 — the reset script | `scripts/db-reset.ts`, `scripts/db-reset.test.ts`, 6 tests, plus the `db:reset` npm entry |
| Cleanup | `scripts/db-seed.ts` lost its redundant `import "dotenv/config"` |

**The registry rule** is path-scoped to `lib/**/registry.ts` and requires `npm run db:seed` in the same change that adds, removes, or renames a registry entry. It went through the `writing-rules` skill and passed all nineteen checklist items.

**The reset script** deletes every job, every trace row, and every company with no ATS board slug. It never writes the settings row, and it drops no table.

**The cleanup was the user's call**, raised as a design smell found while writing the reset script.

## Decisions & Context

**No decision-log entries were added this session.** All six calls were checked against the qualification test and none passed it: two were proposals the user approved rather than decisions they made in their own words, one restates a decision already logged on 2026-08-26, and the rest are measurements. All six are recorded in the Phase 5 spec under "Calls made while building".

### Gotchas found this session

- **Prisma issues no statement at all for `update({ data: {} })`.** A deliberate break written that way changes nothing, so no test can catch it. Rewriting a column with the value it already holds is what moves `modified_at`.
- **`Job.company_id` is `ON DELETE SET NULL`**, not restricting. Deleting a company nulls the job rather than being refused.
- **The commit hook reported four more false test gaps** — `resetJobs`, `resetTraces`, `resetCompanies` and `main`. All are covered. The test runs the script as a separate process and the hook cannot see inside that. Any script tested this way will report the same.
- **Both `crowd-code` writers wrote no JSDoc this time.** Telling them outright that this codebase has zero JSDoc blocks is what stopped it. Keep that line in future writer prompts.
- **`PIPESTATUS` does not survive in the shell tool.** Capture an exit code with `$?` after a redirect rather than through a pipe.
- **`lib/pipeline-env.ts` loads no `.env` of its own.** `scripts/db-create.ts` therefore keeps its own `import "dotenv/config"`, because it calls `getPipelineDatabaseUrl` directly rather than going through `lib/pipeline-db.ts`.

### Carried forward, still true

**Save runs before dedupe exists**, so until Phase 6 two runs of `npm run collect` write two rows for one posting. Expected and short-lived.

**Anything new under `lib/steps/` loads two rules** — `.claude/rules/pipeline-steps.md` for shape and `.claude/rules/naming.md` for names. **Anything touching `lib/collectors/registry.ts` now loads a third**, `.claude/rules/source-registry.md`. **A `BACKLOG.md` change needs the user's approval before it is written.**

**Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **`cat` is blocked on any file over 2048 bytes** by a hook. **Vitest output carries ANSI codes** — strip them with `sed -e 's/\x1b\[[0-9;]*m//g'` before grepping it.

**`npx tsx -e` cannot run top-level `await`.** Probe scripts need a file with a `main()` wrapper.

### Open questions

1. **The live pipeline database is still on the old schema.** Rebuilding is `npm run db:create` then `npm run db:seed`. **The user has been asked four times across sessions and has not answered.** Not asked again this session.
2. **A merged row can name a parser that never parsed it.** Settle in Phase 8. Recorded in the Phase 5 spec.
3. **A renamed collector leaves an orphan entry in the priority list.** The new registry rule makes the seed run on a rename, so the new name is added, but the seed still never removes the old one. In the Phase 5 r&d, unagreed.
4. **Whether Phase 11a wants a database reset of its own.** `npm run db:reset` now exists, which this question did not have available when it was raised. In the Phase 11a r&d.

### How the build loop ran

Task 15: write the test file first, run it red, dispatch two `crowd-code-writer` sub-agents in parallel at Sonnet, combine, apply, go green, then break the code deliberately six ways and confirm every test catches its own break. Task 14 is a rule document, so no writers were dispatched.

Both writers returned near-identical code. The applied version took writer A's header comment and writer B's output wording.

## Next Steps

1. **Build task 16, the company service's conflict lookup.** `lib/company-service.ts` and its test. When the database refuses a create, read the clashing column off the refusal and look that one column up, instead of trying name, match key and slug in turn. Keep the try-each-in-turn path as a fallback for a driver whose error names no column. Correct the comment at line 54, which says the column cannot be read. Criteria 76 and 77 in the Phase 5 spec.

2. **Close phase 5.** Architecture doc, decision log, and any backlog change presented for approval. Then take the 16 tasks back out of `CURRENT-FEATURE.md`, leaving one line linking to the spec.

3. **Commit the uncommitted spec change** if it is still sitting there.
