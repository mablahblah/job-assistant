# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Decisions & Context** section for reasoning that isn't captured elsewhere.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

Feature: **Unified Job Pipeline** — a long-lived branch, `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 6, Dedupe, is planned and ready to build.** Five of fourteen phases are closed. All seven steps of the [phase planning procedure](../docs/features/unified-pipeline/phase-planning-procedure.md) are done.

**The spec is [`phase-06-dedupe-spec.md`](../docs/features/unified-pipeline/phases/phase-06-dedupe-spec.md)** — 18 stories, 90 acceptance criteria, 15 tasks. Its task list is mirrored under the build item in `docs/CURRENT-FEATURE.md`.

**Nothing is uncommitted.** Working tree clean at `f3e8f8f`, pushed to `origin/feature/unified-pipeline`.

**Verified fresh before committing.** `npm run lint` exits 0. `npm run test` exits 0 with 1,545 tests across 56 files.

## Completed This Session

**The nine loose decisions the last hand-off listed are settled.** Four of them turned out to be already answered by the decision log or the existing code, found by auditing rather than by asking.

**Eighteen user stories approved**, replacing fourteen drafts. Eight further candidates were dropped after being found already present in the feature-level dedupe list.

**The phase 6 spec written and reviewed.** `spec-review` raised six findings and all six were settled with the user. The first was a real hole: a merged job dropped its `created_at`, so folding three saved rows left the second fold blind and could orphan a real row.

**Nine decisions logged, two superseded.** The 2026-09-06 entry saying a refused delete writes no trace event was replaced, keeping only its still-true half. The 2026-09-09 `pickWinner` entry was replaced to name `created_at` as the has-a-row signal.

**Meeting notes written** at `meeting-notes/2026-09-09-phase-06-dedupe-meeting-notes.md`, and the index backfilled with four sessions it had been missing.

**A cross-check sub-agent found four contradictions, all real.** Two documents still said Phase 6 ports matching helpers from `legacy/lib/dedupe.ts`, reversed on 2026-09-08. Two placed add-external-job in Phase 12 rather than the backlog. All fixed.

## Decisions & Context

### The through-line, and why four questions dissolved

**Dedupe shares its merge with save, so anything save settled, dedupe inherits.** That is the user's own framing and it is why four of nine supposed open questions were already answered. Before treating a phase 6 question as open, check the decision log and the code — the answer is usually already there.

### The nine decisions are in the feature decision log dated 2026-09-09

Not repeated here. Read [`decision-log.md`](../docs/features/unified-pipeline/decision-log.md).

### Calls made while building, not put to the user

- **The new module names**, all following `.claude/rules/naming.md`: `lib/url-match-key.ts`, `lib/job-identity.ts`, `lib/job-match-label.ts`, `lib/job-dedupe.ts`, `lib/dedupe-warnings.ts`, `lib/steps/dedupe.ts`.
- **Splitting the step into two tasks**, one for its logic and one for its trace rows.
- **Which acceptance criteria belong to which task.**
- **Dropping five decision candidates as work-documentation**, routed to the spec: the 24-hour test reading pooled dates, the `added_to_job_list` collector, proving an index with `PRAGMA`, the split between how the two compares use the clauses, and building for three passes while wiring one.

### Approaches refused, so they do not come back

- **Comparing two job ids as text to break a tie.** A job id is `crypto.randomUUID()`, which is random and carries no age, so the winner would change every run.
- **Time-ordered ids so "older id wins" would be literally true.** Not needed once `created_at` was chosen.
- **Reconstructing the 2026-09-07 and 2026-09-08 meeting notes.** Notes archive what was said; writing them from the decision log and the r&d would invent a conversation from its own output.
- **A guard against a source putting its job id in the query string.** The user never agreed to one and does not want a guard against a problem that has not appeared.
- **Logging the protocol-relative link bug** in `lib/collectors/dribbble-cards.ts:43` and `lib/collectors/uiuxjobsboard-cards.ts:52`. Measured as possible, not known: 325 of 326 fixture links start with a single slash, one with `https://`, none with `//`.

### Gotchas found this session

- **`sqlite3 dev.db "SELECT ..."` reads the live database directly.** That is how the 63 active jobs and their collectors were measured.
- **Renumbering acceptance criteria by hand goes wrong.** Renumber the whole criteria block sequentially with a script, then recompute each task's range from the group headings.
- **`dev.db` holds 63 active jobs, not the 57 the decision log measured in August.** It keeps growing on `main`.

### Carried forward, still true

**`cat` is blocked on any file over 2048 bytes** by a hook — use `sed -n 'START,ENDp'` or the Read tool. **The commit hook prints a graph analysis block** on every commit; harmless. **`grep -r --include=*.ts` fails in this shell** — quote it as `--include="*.ts"`. **Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **Vitest output carries ANSI codes** — strip with `sed -e 's/\x1b\[[0-9;]*m//g'`. **`npx tsx -e` cannot run top-level `await`.** **`PIPESTATUS` does not survive** — use `cmd > file 2>&1; echo $?`. **`npm run lint` runs ESLint and then `npx tsc --noEmit`.**

**Anything new under `lib/steps/` loads two rules** — `.claude/rules/pipeline-steps.md` and `.claude/rules/naming.md`. **Anything touching `lib/collectors/registry.ts` loads a third**, `.claude/rules/source-registry.md`, and requires `npm run db:seed` in the same change. **Editing any file under `.claude/rules/` goes through the `writing-rules` skill.** **A `BACKLOG.md` change needs the user's approval before it is written.**

**`pipeline.db` holds 0 jobs.**

### Open threads

1. **The database rebuild question is closed.** The user's position: rebuild freely so long as the live database is protected. Verified that it is — `scripts/db-create.ts` reads only `PIPELINE_DATABASE_URL`, which `.env` points at `pipeline.db`, and it throws rather than falling back to `DATABASE_URL`, which points at `dev.db`. So `npm run db:create` can only delete `pipeline.db`. Phase 6's task 1 adds two columns, so a rebuild is needed before its code runs.
2. **Whether Phase 11a wants a database reset of its own.** In the phase 11a r&d.
3. **Phase 6 planning ran across several sessions and only the last has meeting notes.** The 2026-09-07 and 2026-09-08 conversations live in the decision log and the phase r&d instead. The index says so.

## Next Steps

1. **Start the build loop** through `start-work-session`, which invokes `crowd-code` once per change. The fifteen tasks are in the [phase 6 spec](../docs/features/unified-pipeline/phases/phase-06-dedupe-spec.md#tasks), each naming its files and its acceptance criteria.

2. **Task 1 is the schema.** `prisma/schema.prisma` and `prisma/schema.test.ts` — add `original_url_match_key` and `resolved_url_match_key` with an index on each, and add dedupe's reasons and its two new events to the `Trace` comment. Criteria 1 to 5. **Run `npx prisma generate` after**, or the client keeps describing the old schema.

3. **Then `npm run db:create` and `npm run db:seed`** to bring `pipeline.db` onto the new schema. Safe: it can only touch `pipeline.db`.

4. **Work tasks 2 through 15 in order.** Task 3 changes `delete_on_save` from a boolean to a reason, so it comes before task 9 marks losers with one. Task 8 rewrites `pickWinner` before task 9 and task 11 call it.

5. **Close phase 6 when the build is done** — architecture doc, decision log, and any `BACKLOG.md` change presented for approval. That is its own checkbox in `docs/CURRENT-FEATURE.md`.
