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

**Phase 6, Dedupe, is in build. Tasks 1 to 5 of 15 are done.** Five of fourteen phases are closed.

**The spec is [`phase-06-dedupe-spec.md`](../docs/features/unified-pipeline/phases/phase-06-dedupe-spec.md)** — 18 stories, 90 acceptance criteria, 15 tasks. Its task list is mirrored under the build item in `docs/CURRENT-FEATURE.md`, where tasks 1 to 5 are ticked.

**One file is uncommitted:** `docs/features/unified-pipeline/decision-log.md`, holding this session's single new entry. Everything else is committed and pushed, working tree otherwise clean at `52b4fff`.

**Verified fresh before the last commit.** `npm run test` exits 0 with 1,591 tests across 57 files. `npm run lint` exits 0.

**`pipeline.db` is on the new schema.** Rebuilt with `npm run db:create` and reseeded with `npm run db:seed` after the index landed. It holds 0 jobs, 0 traces, 21 seeded ATS companies and 1 settings row, at 57,344 bytes. `dev.db` is untouched at 2,191,360 bytes.

## Completed This Session

**Four spec tasks built, plus one schema change the spec does not name**, in ten commits:

- `95b4cbb` — docs: record phase 6 task 1's two decisions and its hand-off
- `6f24221` — feat: add the link match key, `lib/url-match-key.ts`
- `2e46ea8` — docs: correct phase 6 task 3's criterion number
- `7f9b945` — feat: `delete_on_save` carries the dedupe reason, not a boolean
- `07afeab` — docs: tick phase 6 tasks 2 and 3
- `3a7f00a` — feat: stamp both link match keys on every write to Job
- `35ff45f` — docs: tick phase 6 task 4
- `371d3c7` — feat: the job service fake stamps the keys and the timestamps
- `62b216d` — docs: tick phase 6 task 5
- `52b4fff` — feat: index Job on company_id and title together

**Task 2 — `lib/url-match-key.ts`.** One util, `urlMatchKey(url): string | null`. Keeps the scheme, the lowercased host, and the path with any trailing slash dropped. Throws the whole query string and any fragment away. Returns `null` for a string that is not a URL. 16 tests, criteria 6 to 14.

**Task 3 — `delete_on_save` carries a reason.** `lib/job-list-entry.ts` gained `DEDUPE_REASONS` and a `DedupeReason` type derived from it, and the field's type changed from `boolean`. 19 test call sites across three files swapped `true` for `hard_match_in_list`. Criterion 55.

**Task 4 — keys on every write.** `lib/job-service.ts` gained `stampLinkMatchKey`, `toColumnData` now stamps both keys and strips `created_at`, and the update path calls `toColumnData(merged)` where it used to spread `merged` raw. 7 tests, criteria 15 to 20 and 49.

**Task 5 — the job service's fake.** `lib/job-service.fake.ts` mirrors all of it, plus sets `created_at` and `modified_at`. 9 tests, criteria 21 to 23.

**The `company_id` and `title` index**, with two tests in `prisma/schema.test.ts`. Not a spec task — see the open threads.

**One decision logged**, dated 2026-09-09. It supersedes nothing.

## Decisions & Context

### The decision is in the feature decision log dated 2026-09-09

Read [`decision-log.md`](../docs/features/unified-pipeline/decision-log.md). In short: `Job` takes one combined index on `company_id` and `title` rather than one on each.

### Calls made while building, not put to the user

- **`urlMatchKey` keeps a port**, using `URL.host` rather than `URL.hostname`. Dropping it would give `example.com:8080/x` and `example.com/x` one key, which is two servers folded into one job.
- **Only the host is lowercased.** The path keeps its case, because a posting id in a path can be case-sensitive.
- **`DEDUPE_REASONS` holds three reasons, not dedupe's four.** `matched_list_entry` sits on a stored row joining the list, never on an entry leaving it, so it can never mark anything for deletion.
- **All 19 swapped test call sites took `hard_match_in_list`** as filler. Task 13 is where save starts caring which reason it got.
- **The three-case link rule**, used identically by the real service and the fake: a string link stamps a key, a null link nulls the key, a link the write never mentions leaves the stored key alone.
- **The fake strips `created_at`**, mirroring `toColumnData`. Without it criterion 23 only passes by luck, because `mergeJobs` happens to drop the field today. Task 8 moves it out of `NEVER_WRITTEN_FIELDS` and the fake would then start overwriting a birthday.
- **`modified_at` moves on a status-only write** to an active row, because the schema marks it `@updatedAt` and that fires on any update. It does not move on an `unchanged` result, because nothing was written.
- **Timestamp tests set `modified_at` to a past date first**, then assert it moved forward. Two writes can land inside the same millisecond, so comparing against a fresh clock is flaky.
- **The two spec criterion-number corrections.** Task 3 cited criterion 56, which is task 9's clause short-circuiting rule; it now cites 55. Task 9's range narrowed from "51 to 58" to "51 to 54 and 56 to 58".

### Gotchas found this session

- **A `crowd-code` writer will stamp a derived value from the arriving side, not the merged side.** Both Sonnet writers on task 5 built the link key from the link the entry arrived with, ignoring that `mergeJobs` runs a contest the arriving link can lose. Proven by applying one and watching a row hold the greenhouse link beside the adzuna key. Escalating to Opus with the rule spelled out fixed it. **Any future task deriving a value after a merge needs the prompt to say which side to read from.**
- **The commit hook flags private helpers as untested** even where tests cover them through the module's public method. It flagged `stampLinkMatchKey`, `toColumnData` and `writeToExistingRow`, all of which 20 tests exercise.
- **`sqlite3 pipeline.db "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='Job';"` lists a table's real indexes.** That is how the missing `company_id` index was found rather than inferred.
- **Prisma and SQLite do not index a foreign key for you.** `company_id` had no index despite being a relation field.

### Approaches refused, so they do not come back

- **A test tying `DEDUPE_REASONS` to the schema's `Trace` comment.** It needs the comment-reading helper from `prisma/schema.test.ts` copied across, which breaks the DRY rule. Left as an open thread instead.
- **Two separate indexes on `company_id` and on `title`.** The clause searches on both at once, so the database would pick one and scan for the other.
- **Making the fake test the link key with a truthiness check.** The real service tests `typeof link === "string"`, and a fake exists to mirror the real thing rather than reach the same answer another way.

### Carried forward, still true

**`cat` is blocked on any file over 2048 bytes** by a hook — use `sed -n 'START,ENDp'` or the Read tool. **The commit hook prints a graph analysis block** on every commit; harmless. **`grep -r --include=*.ts` fails in this shell** — quote it as `--include="*.ts"`. **Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **Vitest output carries ANSI codes** — strip with `sed -e 's/\x1b\[[0-9;]*m//g'`. **`npx tsx -e` cannot run top-level `await`.** **`PIPESTATUS` does not survive** — use `cmd > file 2>&1; echo $?`. **`npm run lint` runs ESLint and then `npx tsc --noEmit`.**

**A `crowd-code-writer` returns `<` and `>` HTML-escaped.** Convert them back to real angle brackets before applying a snippet.

**After editing `prisma/schema.prisma`, run `npx prisma format` and then `npx prisma generate`,** then `npm run db:create` and `npm run db:seed`. `db:create` deletes and rebuilds `pipeline.db`; it can only ever touch that file.

**Anything new under `lib/steps/` loads two rules** — `.claude/rules/pipeline-steps.md` and `.claude/rules/naming.md`. **Anything touching `lib/collectors/registry.ts` loads a third**, `.claude/rules/source-registry.md`, and requires `npm run db:seed` in the same change. **Editing any file under `.claude/rules/` goes through the `writing-rules` skill.** **A `BACKLOG.md` change needs the user's approval before it is written.**

**Every message to the user over one paragraph ends with a one-sentence TL;DR.** This is in the user's global `CLAUDE.md` and was missed repeatedly this session until the user asked for it.

### Open threads

1. **The contested-link guard test is missing from `lib/job-service.test.ts`.** The fake has it and the real service does not. The same bug there would silently split one job into two rows. The user was offered it twice and did not answer either way.
2. **`DEDUPE_REASONS` and the `Trace` comment can drift apart** with nothing complaining. The comment in `prisma/schema.prisma` is the source of truth per the 2026-09-09 decision, and the code list is a hand copy of three of its four dedupe reasons.
3. **The `company_id` and `title` index belongs to no spec task.** Task 1 is closed and named only the two link-key indexes. The spec's task list and its regression net now understate what the schema carries. Fix at the phase close, or add it to task 11's file list where the lookup that needs it gets written.
4. **`tableIndexes` in `prisma/schema.test.ts` has no test of its own.** Six tests now call it. The user was offered one and did not answer either way.
5. **Task 8 adds a third "the merge does not settle this" group.** `NEVER_WRITTEN_FIELDS`, `DERIVED_AT_WRITE_FIELDS`, and task 8's group for what is carried in memory and stripped at the write. Whether three is right, or two would do, is a question nobody has asked.
6. **The writer-skipping decision is rule-shaped.** It belongs as an edit to `crowd-code`'s SKILL.md, which today says only "if it is not code, make it directly and stop" and leaves a Prisma schema unclassified. Used once this session, on task 3. Raise it at the phase close.
7. **Whether Phase 11a wants a database reset of its own.** In the phase 11a r&d.
8. **Phase 6 planning ran across several sessions and only the last has meeting notes.** The 2026-09-07 and 2026-09-08 conversations live in the decision log and the phase r&d instead. The index says so.

## Next Steps

1. **Commit the decision log.** One uncommitted file holding this session's entry.

2. **Task 6 is the identity clauses.** `lib/job-identity.ts` and its test — the three clauses, the every-field-present gate, the 30-day window over each side's latest date, and the shared-host veto on company and title. Criteria 24 to 36. Three calls already worked out and not yet built: one exported `matchingClause(a, b)` returning the first clause that fires or nothing, clause names `original_url` / `resolved_url` / `company_and_title` because criterion 80 writes them into a trace row, and "company" meaning `company_id` because the phase r&d requires every clause be database-lookupable.

3. **Then tasks 7 through 15 in order.** Task 8 rewrites `pickWinner` before task 9 and task 11 call it.

4. **The build loop runs through `start-work-session`**, which invokes `crowd-code` once per change.

5. **Close phase 6 when the build is done** — architecture doc, decision log, and any `BACKLOG.md` change presented for approval. That is its own checkbox in `docs/CURRENT-FEATURE.md`.
