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

Nothing is in progress. The session closed on a clean boundary.

The job pipeline is being rebuilt on `feature/unified-pipeline`. Real job searches still run from `main`.

**Phases 0 through 7b are built and closed.** `npm run job-search` runs the whole pipeline against real job sites and prints a summary. Phase 8, Parsers, is next and has not been planned.

1,932 tests pass across 80 files. `npm run lint` exits 0. Both verified at session end. The working tree is clean and the remote matches at `83ca7ce`.

## Completed This Session

**Phase 7a, tasks 6 to 10.**

A handler that throws now stops the run instead of escaping. The report names the spot and the reason, lists the handlers that finished with their counts, and the command exits non-zero. Every read between handlers is caught the same way, because a throw escaping takes the whole report with it.

`lib/tools/resolution-browser.ts` is the first tool. It launches one visible Chromium per run and gives each job a fresh context. It takes its launcher as an argument so tests never open a window.

`scripts/job-search.ts` replaced `scripts/collect.ts`, and `package.json` moved with it. It prints a summary rather than a job list.

The `job-search` skill was rewritten to run the one command and read the summary.

The pipeline ran for real. Fourteen jobs collected from seven sources, eleven resolved, three not.

**Phase 7b, which did not exist at session start.**

A full vocabulary cleanup. The user asked for an audit of every metaphor and coined term, annotated the result, and chose 32 terms to change across 212 files. Twelve were code names, three were values stored in `Trace`, the rest was prose.

**Two defects the live run found, both fixed.**

A page whose address carries an error flag was saving as a real posting. A board redirects a dead job id to the employer's whole listing, answers HTTP 200, and says so only in the address. That is now the failed reason `posting_gone`.

The summary printed "1 jobs". Zero keeps the plural; one does not.

## Decisions & Context

### What the user decided

Ten entries were added to the feature decision log, all dated 2026-09-11. The ones that shape later work:

- A handler that throws stops the run, and so does a failed read between handlers, so the finished steps' saved work still reaches the user.
- A finished handler is named in the report by its `Trace.step` name, because one dedupe handler runs at two positions.
- The run summary is built from trace rows rather than from what the orchestrator returns, and carries only collection, the post-collection dedupe and resolution.
- A collector that hands over an already-resolved job writes a `job_resolved` trace row with the reason `collector_provided`.
- **Every phase from here adds its trace rows and its own summary block, not just its handler.** This is now a constraint in the feature spec.
- The vocabulary cleanup runs before the rest of the pipeline is built, because every later phase would otherwise be written in the words being removed.
- A leg of the pipeline is called a step. `Trace.step` already names a position, and a leg is a position.
- `walk` is replaced by `resolution`, and by "one job's resolution" where the per-job part matters.

### Calls made while building

These are in the phase 7a spec under "Calls made while building", not in the decision log, because the user did not make them.

- The spot a run stopped at is passed to the catch as an argument, so a handler added later cannot be reported under the previous one's name.
- The browser tool takes its launcher as an argument.
- One spot name was added beyond the agreed list, `browser_close`.
- The finished-handler list prints only on failure.

### Facts a fresh session needs

- **The command is `npm run job-search`.** `npm run collect` is gone.
- **The new pipeline uses `pipeline.db`.** `dev.db` is `main`'s live database and this branch never touches it.
- **A database can drift from the schema with nothing warning.** The first live run failed because `pipeline.db` predated the `resolution_concurrency` column, and every collector threw the same SQL error. `npx prisma db push` adds a missing nullable column and keeps the rows. `npm run db:create` destroys them. Backlog entry 42 covers warning about this.
- **`lingo-audit.md` and `lingo-rename-map.md` deliberately still contain the old words.** Any future find-and-replace must exclude them. One pass rewrote them and they had to be restored from git.

### Gotchas discovered

- **BSD `sed` has no `\b`.** Use `perl -pi -e` or python for identifier renames.
- **`perl -pi -e '...' $FILES` fails silently on a long file list.** Use `find ... -print0 | xargs -0 perl -i -p script.pl`.
- **A shell loop using `"$w[a-z]*"` inside double quotes expands as a variable named `w[a-z]`** and silently returns zero matches. Use `"${w}[a-z]*"`. This produced false "0 remaining" counts twice during the cleanup, and both times the work looked finished when it was not.
- **`.{0,40}word.{0,40}` over many files backtracks catastrophically and hangs.** Use fixed-width context or plain `grep -n`.
- **Two renames collided with existing names.** `hop` to `page` hit the `page` parameter in `lib/resolve-job-url.ts`; the loop counter became `pagesOpened`. `lease` to `openPage` hit the `openPage` method; the local became `opened`. The typecheck caught both.

### Approaches abandoned

- **Inferring how many jobs arrived already resolved, as jobs saved minus jobs resolved.** The two numbers cover different jobs: resolution reads its list from the database and also processes jobs an earlier run collected, so on a second run the subtraction can go negative. A trace row at collection replaced it.
- **A content scan to catch the error page.** The page carries no error wording at all — it renders 95 real jobs. The address was the only evidence.

### Open questions

1. **`.claude/CLAUDE.md.bak` and `.claude/session-status.md` are now tracked and pushed.** A `git add -A` swept them in. The user was told and has not said whether to untrack them. This has been unanswered for eight sessions.
2. **The over-merge query that backlog entry 26 owes has not been run.** Its trigger was the first real run, which has now happened. The query is resolved links shared across distinct job ids, sliced by the rule that accepted them.
3. **Two jobs stopped on their own aggregator and saved as resolved.** One on Adzuna, one on CareerBuilder. Recorded as a seventh weakness in the resolver-refinements r&d. No decision yet on whether to fix.

## Next Steps

1. **Plan phase 8 — Parsers.** Follow the phase planning procedure. It is the next unchecked item in `docs/CURRENT-FEATURE.md`.
2. **Before planning, settle open question 3.** Whether aggregator stops are fixed in phase 8's parser work or stay in the resolver-refinements backlog changes what phase 8 owns.
3. **Run the over-merge query** from open question 2. It is one query and it measures whether resolution is accepting wrong pages.
4. **Remember the new spec constraint when planning phase 8.** Parsing must add its trace rows and its own block in the run summary, not just its handler.
