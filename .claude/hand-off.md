# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Session Context** section for reasoning that isn't captured elsewhere. The decisions the user made are not in this document — read [the feature decision log](../docs/features/unified-pipeline/decision-log.md) for those.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

**Phase 12, the Web UI, is built. All nineteen tasks are done and checked off.** The phase is not closed. Closing it means the architecture doc, any backlog changes presented for approval, and a commit.

**Nothing is committed.** 19 files changed and 24 new files, all from this session alone. No second session ran against this branch.

Verified at session end: **150 test files, 3,229 tests passed, 17 skipped. `npm run lint` exits 0, including its type check.** The 17 skipped tests are skipped on purpose and predate this session.

The dashboard was run by hand against a throwaway database and works. The real `dev.db` still does not match the code, so the dashboard refuses to start against it. That is expected and needs no action before the migration.

## Completed This Session

**Nine new plain-logic files in `lib/utils/`**: the ruled-out status list (added to `job-status.ts`), plus `escape-html.ts`, `score-display.ts`, `relative-date.ts`, `score-total.ts`, `score-reasoning.ts`, `work-log-weeks.ts` and `salary-periods.ts`.

**Two new shape files in `lib/types/`**: `job-row.ts` and `work-log-row.ts`. Neither has a test, deliberately.

**A new folder, `lib/views/`**, holding `job-table.ts`, `work-log.ts` and `page.ts`. The naming rule and `CLAUDE.md` both gained a row describing it.

**A new tool, `lib/tools/web-server.ts`**, with a stand-in beside it. It answers a made-up request with no port opened, and refuses to start against a database that does not match the code.

**Two new reads on the job service** — jobs by status, and jobs by id — each handing back the job and its employer side by side. **One new read on the work log service** — every entry, newest first. Both stand-ins learned theirs, and the job stand-in grew an employer table as a third argument.

**`scripts/serve.ts` is new**, `public/` holds the stylesheet and switcher script copied out of `legacy/`, and `npm run serve` points at the new command.

**Backlog item 32 is new**, with an r&d file at `docs/features/scoring-reasoning-panel/`. Adding it renumbered every Future Ideas item by one, and one stale reference in the phase 11 meeting notes was corrected.

## Session Context

The decisions the user made are in [the feature decision log](../docs/features/unified-pipeline/decision-log.md). **Nothing was written to it this session** — two entries were drafted and the user rejected both.

### Calls made while building

All four are written into the phase 12 spec's **Decided while building** section. Read them there rather than here.

### The eye check found what it was built to find

Task 19 existed to judge by eye whether a plain browser tooltip could hold five paragraphs of reasoning. **It could not.** A real example measured 2,848 characters across five blocks and the browser cut it off. The tooltip now carries the job's own reasoning alone, 704 characters. The employer's four categories are saved and shown nowhere. Phase 12's acceptance criteria 157, 158 and 159 were rewritten, and backlog item 32 holds the panel that could carry all five.

### Write plainly

The user said twice that the writing used too much lingo — once about an explanation, once about the drafted decision log entries and the backlog item. The backlog item was rewritten in plain words. Both drafted decision log entries were rejected outright. Anything written for this user names the literal thing rather than the term of art, and explains a technical name beside it.

### Gotchas discovered

**The job service test file shares one database across every test.** Three tests written this session failed on first run for that reason — an employer name already taken, and a status other tests had already used. A new test finds its own row by id rather than taking the first result.

**The job table view renders no job id.** Two ordering tests failed because they searched the output for an id that never reaches the page. They mark rows by title instead.

**`scripts/serve.ts` must not contain the word "trace" in any casing**, including in prose. A test reads the file and checks for it, which is how criterion 176 — that reading a page writes no record of a run — is proven.

### Approaches tried and abandoned

**Putting all five pieces of reasoning in the tooltip.** Built, measured, rejected by eye. See above.

**Giving the two page shapes a list of their field names, checked against the database columns.** Offered and declined. Those shapes only join shapes that already exist and are already tested.

### Open questions

**The dashboard has never been opened against real data.** Every check this session ran against a throwaway database holding four jobs and one work log entry. How the page behaves with 1,800 jobs is unknown.

**A Workable parser is still unprioritized.** Carried from the previous hand-off and untouched. It cost 32 jobs in the first live run.

**The broken documentation link count was 65 at the last hand-off** and was not checked this session.

## Next Steps

1. **Close phase 12.** Update `docs/features/unified-pipeline/architecture.md` to describe the dashboard as built — the views folder, the server tool, the two service reads, the serve command. Present any backlog change for approval. The decision log step already ran and the user declined both entries.

2. **Commit.** One session's work, one unit: phase 12 built. 43 files.

3. **Plan phase 13, migration and switch over.** The last phase before shipping. Deleting `legacy/` in one move is what it builds toward, and `npm run cli` is the last thing still pointing into that folder.
