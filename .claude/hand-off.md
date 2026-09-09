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

**Phase 6, Dedupe, is in build. Task 1 of 15 is done.** Five of fourteen phases are closed.

**The spec is [`phase-06-dedupe-spec.md`](../docs/features/unified-pipeline/phases/phase-06-dedupe-spec.md)** — 18 stories, 90 acceptance criteria, 15 tasks. Its task list is mirrored under the build item in `docs/CURRENT-FEATURE.md`, where task 1 is now ticked.

**Nothing is uncommitted.** Working tree clean at `1ab0cb9`, pushed to `origin/feature/unified-pipeline`.

**Verified fresh before committing.** `npm run test` exits 0 with 1,554 tests across 56 files. `npm run lint` exits 0.

**`pipeline.db` is on the new schema.** Rebuilt with `npm run db:create`, reseeded with `npm run db:seed`. It holds 0 jobs, 0 traces, 21 seeded ATS companies and 1 settings row. `dev.db` is untouched at 2,191,360 bytes.

## Completed This Session

**Task 1 is built, tested, committed and pushed**, in two commits:

- `24f72e3` — feat: add the two link match-key columns and their indexes
- `1ab0cb9` — docs: correct phase 6 task 1's file list

**Five files carried task 1, not the two the spec named.** `prisma/schema.prisma` gained `original_url_match_key` and `resolved_url_match_key`, each an optional string with a non-unique `@@index`, and its `Trace` comment gained dedupe's four reasons and the phase's two new events. `prisma/schema.test.ts` gained a `tableIndexes` helper and seven tests. `lib/job-list-entry.ts` gained the two names in `JOB_LIST_ENTRY_FIELDS`. `lib/job-merge.ts` gained a group, `DERIVED_AT_WRITE_FIELDS`, and `lib/job-merge.test.ts` gained it in the completeness check.

**The spec's own file lists were wrong and are fixed.** Task 1 now names all five files and says why the two extra guards fire. The regression net no longer claims `lib/job-list-entry.test.ts` gains the columns, and its `lib/job-merge.test.ts` row now names the new group.

**Two decisions logged**, both dated 2026-09-09. Neither supersedes anything.

## Decisions & Context

### The two decisions are in the feature decision log dated 2026-09-09

Not repeated in full here. Read [`decision-log.md`](../docs/features/unified-pipeline/decision-log.md). In short: the match keys take a merge group of their own, and a `crowd-code` change whose code is declarative skips the two writer sub-agents while still writing its failing test.

### Calls made while building, not put to the user

- **Ran `npx prisma format` after editing the schema.** It realigned every `Job` field by two characters, because the new names are longer than the previous longest. That is why the diff shows 101 changed lines rather than about 20.
- **Each column sits beside the link it keys**, `original_url_match_key` after `original_url` and `resolved_url_match_key` after `resolved_url`.
- **Both `@@index` lines sit at the foot of the `Job` model** under one shared comment rather than a comment each.
- **The two-rows-one-key test is raw SQL** through `@libsql/client`, not the generated Prisma client. What is under test is the database refusing nothing, and raw SQL does not depend on the client having been regenerated.
- **`tableIndexes` reads `PRAGMA index_list` then `PRAGMA index_info` per index**, so a test matches on the column an index covers rather than the name Prisma gave it.
- **"An index exists" and "no index is unique" are separate tests**, one per criterion, and the uniqueness one also asserts the index exists. Otherwise it passes over an empty list, which is a schema carrying no index at all.

### Gotchas found this session

- **Adding a `Job` column trips two completeness guards.** `JOB_LIST_ENTRY_FIELDS` in `lib/job-list-entry.ts` needs the name, and `lib/job-merge.ts` needs it in one of its groups. Both are deliberate, and every future column-adding task hits both.
- **`lib/job-list-entry.test.ts` needs no edit when a column is added.** It reads the live `Job` columns out of a scratch database. The hand-written constant beside it is what changes.
- **`npx prisma format` reflows a whole model's alignment** when a new field name is longer than the previous longest.
- **The commit hook reports a test gap for any new helper, test-only ones included.** It flagged `tableIndexes`.

### Approaches refused, so they do not come back

- **Widening `NEVER_WRITTEN_FIELDS` to cover the match keys.** It would file two different reasons under one name, and task 8 empties half that group anyway when `created_at` moves out.
- **Dispatching the two `crowd-code` writers** for the schema and for the two-string array edit. Neither gives two competing writers anything to compete over.
- **Writing the two-rows-one-key test through the generated Prisma client.** Raw SQL tests the database itself and does not depend on `npx prisma generate` having run first.

### Carried forward, still true

**`cat` is blocked on any file over 2048 bytes** by a hook — use `sed -n 'START,ENDp'` or the Read tool. **The commit hook prints a graph analysis block** on every commit; harmless. **`grep -r --include=*.ts` fails in this shell** — quote it as `--include="*.ts"`. **Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **Vitest output carries ANSI codes** — strip with `sed -e 's/\x1b\[[0-9;]*m//g'`. **`npx tsx -e` cannot run top-level `await`.** **`PIPESTATUS` does not survive** — use `cmd > file 2>&1; echo $?`. **`npm run lint` runs ESLint and then `npx tsc --noEmit`.** **`sqlite3 pipeline.db "SELECT ..."` reads the database directly**, which is how its row counts were taken.

**Anything new under `lib/steps/` loads two rules** — `.claude/rules/pipeline-steps.md` and `.claude/rules/naming.md`. **Anything touching `lib/collectors/registry.ts` loads a third**, `.claude/rules/source-registry.md`, and requires `npm run db:seed` in the same change. **Editing any file under `.claude/rules/` goes through the `writing-rules` skill.** **A `BACKLOG.md` change needs the user's approval before it is written.**

**`npm run db:create` can only delete `pipeline.db`.** Verified again this session: `scripts/db-create.ts` reads only `PIPELINE_DATABASE_URL`, `.env` points that at `pipeline.db`, and it throws rather than falling back to `DATABASE_URL`.

### Open threads

1. **`tableIndexes` in `prisma/schema.test.ts` has no test of its own.** Four tests call it. The user was offered one and did not answer either way.
2. **Task 8 adds a third "the merge does not settle this" group.** `NEVER_WRITTEN_FIELDS` for what the database owns, `DERIVED_AT_WRITE_FIELDS` for what the job service derives, and task 8's group for what is carried in memory and stripped at the write. Whether three is right, or two would do, is a question nobody has asked. This is an observation, not a decision.
3. **The writer-skipping decision is rule-shaped.** It belongs as an edit to `crowd-code`'s SKILL.md, which today says only "if it is not code, make it directly and stop" and leaves a Prisma schema unclassified. The skill is untouched. Raise it at the phase close.
4. **Whether Phase 11a wants a database reset of its own.** In the phase 11a r&d.
5. **Phase 6 planning ran across several sessions and only the last has meeting notes.** The 2026-09-07 and 2026-09-08 conversations live in the decision log and the phase r&d instead. The index says so.

## Next Steps

1. **Task 2 is the link match key.** `lib/url-match-key.ts` and its test — scheme, lowercased host, path with any trailing slash dropped, query and fragment removed, and nothing returned for a string that is not a URL. Criteria 6 to 14. It lives beside `companyMatchKey(name)` and follows the same shape.

2. **Then tasks 3 through 15 in order.** Task 3 changes `delete_on_save` from a boolean to a reason, so it comes before task 9 marks losers with one. Task 8 rewrites `pickWinner` before task 9 and task 11 call it.

3. **The build loop runs through `start-work-session`**, which invokes `crowd-code` once per change. Every task after task 1 is ordinary TypeScript, so the writer sub-agents run normally.

4. **Close phase 6 when the build is done** — architecture doc, decision log, and any `BACKLOG.md` change presented for approval. That is its own checkbox in `docs/CURRENT-FEATURE.md`.
