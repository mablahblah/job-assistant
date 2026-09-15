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

**Phase 10, Scoring, is planned. No code was written. Nothing is in progress.** The next unit of work is building it, starting at task 1.

Verified at session end: **2,509 tests pass across 112 files. `npm run lint` exits 0. The working tree is clean and everything is pushed.** Four commits this session, plus the 23 that were already waiting.

The 24 build tasks are in [the phase spec](../docs/features/unified-pipeline/phases/phase-10-scoring-spec.md#tasks) and mirrored in `docs/CURRENT-FEATURE.md`.

## Completed This Session

**Phase 10 planned end to end.** A brain dump, 22 questions settled with the user, a four-agent stress test, a two-agent platform check, and four rounds of grading the criteria and the assembled spec.

**The spec holds 120 acceptance criteria, 24 tasks, 22 edge cases and 16 stories.** Every criterion is claimed by a task, and every task traces to criteria.

**The phases were renumbered.** The Web UI is now 12 and the switch over is 13. Two r&d files were renamed and 22 files updated.

**Three backlog items** were added, and four documents were corrected where they had stopped being true.

## Session Context

The decisions the user made are in the feature decision log, dated 2026-09-15. Twenty entries. One older entry, from 2026-08-26, was removed because this session replaced it.

### The three things that changed shape while planning

These matter most to whoever builds.

**The ATS board lists move out of the company record.** `ats_platform` and `ats_slug` are deleted. A table of its own replaces them: one row per slug, the slug unique across the table, holding the slug, the company, the parser that read it, and a collector. Company matching writes the row after a posting is read, with no collector. Promotion adds the collector, and adding it is what puts a company on a polling list.

That separates two facts the old columns forced together: that a company posts on Greenhouse, and that we poll it every run.

**The real size of that change was three times what planning first recorded.** Four call sites were named; a repo-wide count found 24 files and 220 references. One was `scripts/db-reset.ts:23`, which deletes every company whose slug is empty in order to spare polled boards. Nobody had named it, probably because `db:reset` is not in the commands table in `CLAUDE.md`.

**Scoring is one orchestrator file with two starting points.** One gathers the work, the other saves the results. `runJobSearch` runs every step in one pass and returns at the end — it cannot pause while an agent thinks, and a command run through an agent's shell cannot be fed a result after it has returned. The saving command is called more than once, so scores land as they are produced rather than being held until the end.

**A handler may be handed any list.** The contract said a job list, with collection as the only exception. Clearing company scores has no job list. Rather than a second exception, the rule widens. `saveCompanies` joins `saveJobs`.

### Gotchas discovered

**`dev.db` at the repo root is main's database, on the old schema.** It holds real job history and is genuinely useful for measuring real-world questions with `sqlite3`. It is not the new pipeline database. Querying it settled one planning question in a minute: of 483 companies with ATS jobs, only two had jobs on two systems, and both turned out to be mid-migration rather than using both at once.

**Tool output does not reach the user's terminal.** A command run through the agent's shell prints to the agent. Paste the summary into the reply, or have the user run it with a `!` prefix.

**Two test suites running at once report a false error.** Run the suite once at a time.

**Word choice is load-bearing here.** A grader caught the spec using "step" for the code that runs at a pipeline position. This project calls that a handler and reserves "step" for the position itself — the value a trace row stores. The first fix pass missed eight instances.

### Approaches tried and abandoned

**A slug row keyed by collector.** The first shape tied every row to the collector that polls it. The user rejected it: the collector only matters once a company is being polled, so it cannot be part of the row's identity.

**A duplicate-slug warning.** Designed, then dropped. Nothing can trigger it — a second job carrying an existing slug matches that slug's company at association and never reaches the point of writing a row.

**A count of failed board polls.** Agreed, then dropped once demotion moved to the backlog. Nothing this phase builds would read it. The existing warning already names the company slug behind a dead board.

**Sweeping empty company rows.** Left the phase entirely. An orphan company costs one unused row that nothing reads.

### Open questions

**Two employers whose names produce the same board slug.** Deliberately unsolved until it is seen happening. The failure it would cause is a job quietly joined to the wrong company, because `lib/handlers/association.ts:84` tries a slug before a name. The fix, if ever needed, is to match on the parser and the slug together.

**Promotion's note when the step has no jobs.** Carried over unresolved from phase 9.

**Two live map-service checks outstanding from phase 9** — a county, and proof that outline simplification shrinks a country's outline.

**Backlog items 6 and 7 are largely superseded by phase 10.** Company Scoring Improvements has five tasks and this phase builds four of them. ATS Company Graduation is this phase's headline. Both were deliberately left for the backlog sweep that runs after the feature ships.

**`CLAUDE.md` line 37** was corrected this session for classification, which has been running end to end since phase 9. Task 24 adds scoring when it ships.

## Next Steps

1. **Build phase 10, starting at task 1** — the schema gains the ATS slug table. Follow the `start-work-session` build loop. Tasks 1 to 7 are all schema and its guardrails, and several have hard test gates that fail the moment a column is added: the merge test asserts every job column is named as merged or excluded, and the schema test asserts the checked-model list matches the schema.
2. **Expect task 3 to be the big one** — deleting the two company columns touches 24 files.
3. **Read the spec's Approach section before task 18.** The orchestrator's two starting points are unlike every other orchestrator in the project.
