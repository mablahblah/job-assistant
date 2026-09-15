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

**Phase 9 is built, closed and verified. Nothing is in progress.** The next unit of work is planning phase 10, Scoring.

Verified at session end: **2,509 tests pass across 112 files. `npm run lint` exits 0. Working tree clean. 23 commits are unpushed, 11 of them from this session.**

The phase 9 task list has moved out of `docs/CURRENT-FEATURE.md` and back into its spec, which is the record of what was built. `docs/features/unified-pipeline/architecture.md` now describes the three judging steps as built.

## Completed This Session

**Phase 9's last seven tasks, one commit each.**

The three steps that judge a job: backlog cleanup sweeps the backlog before any collector runs, promotion returns jobs an employer listed again, and classification decides repost, age and distance. All three are wired into the orchestrator, each with its own save. The user's location becomes coordinates once per run. Three summary blocks follow the run-summary rule. This phase's vocabulary is written into the `Trace` model comment, `trace-events.md` and the schema test.

**Phase 9 closed.** The architecture doc gained the three steps, the `Place` table, ten new parts, and what did not port from the old geocoding code.

**One fix outside the phase.** The settings test stand-in answers the real seeded values instead of zeroes.

**Two live job searches**, which verified the pipeline end to end through classification.

## Decisions & Context

### The user's decisions

**The expiry threshold stays at 8 days.** The first live run expired 24 of 34 jobs, the youngest 9 days old. Asked whether to raise it; the answer was no.

**A repost flagged from two sources disagreeing is the pipeline working, not a defect.** An aggregator listed a job as posted today while the employer's own posting said three weeks ago. The spec defines a repost as two posting dates further apart than the gap, so the flag is correct. This was raised as a bug and was wrong to call one.

**The database was rebuilt rather than backfilled.** The old `pipeline.db` held 174 jobs ready for classification, none carrying the split place list, because that column is new. Filling old rows is Phase 13's job.

**The settings test stand-in answers real seeded values.** Zero is not a blank for these settings — a zero expiry threshold expires every job. The four title vocabularies stay empty, because their seeded values are long lists already hand-copied into two other test files.

**A single shared copy of the seeded defaults was declined.** Moving `SETTING_DEFAULTS` into `lib/` so the seeder, the stand-in and three tests all read one copy was offered and turned down.

### Calls made while building

**A map lookup that throws is recorded as `location_unreadable`**, the same as a place that could not be read. From the job's point of view they are the same thing, and it keeps every job to exactly one outcome row.

**A home location that cannot be placed on a map stops the run.** Measuring against nothing would mark every job as not matching.

**Promotion's note is hidden when the step has no jobs.** Reading the real output afterwards, this looks wrong: `Promotion (0 jobs)` alone does not say what promotion is, and the note is what explains it. Unresolved.

**A summary line's count is right-aligned to the width of its own heading's count.** That is what the spec's worked example does, and it makes the lines read as summing to the heading.

**Every age in a run measures against `collectedAt`**, the one date the caller hands the run.

**Two reads moved earlier in the orchestrator.** The source priority list is now read before collection, because the backlog save is the run's first write. The expiry threshold is read once and shared by all three steps.

**Collection now adds its warnings to the report rather than replacing it.** Both sub-agents caught this: the old line would have thrown away the backlog save's warnings.

### Gotchas that cost time

**Tool output does not reach the user's terminal.** A run started through the Bash tool prints its summary to the agent, not to the user. Paste the summary into the reply, or tell the user to run `! npm run job-search -- --limit 10` so it prints in their session.

**A live run rewrites two collector fixtures.** `dribbble.html` and `uiuxjobsboard.html` are captured from the live site as the collector runs. The suite passed against the new copies and they were committed.

**`npx prisma db push` is additive and safe.** Run against the old database it added the `Place` table and five nullable `Job` columns while keeping all 325 rows. `npm run db:create` deletes the file first; `db push` alone does not.

**`scripts/db-seed.ts` runs `main()` at import**, so `SETTING_DEFAULTS` cannot be imported from it. That is why the test stand-in hand-copies the values.

**A script must live inside the repo for its imports to resolve.** One written to the scratchpad could not find `@libsql/client`. Use `sqlite3` directly for quick database questions.

**Two test suites running at once report a false error.** Run the suite once at a time.

### Sub-agent answers rejected, and why

**An unsafe cast from `JobListEntry` to the age type.** One writer cast the whole job rather than naming the three fields, which would crash on a job carrying no date at all.

**`.js` import extensions.** Both orchestrator writers added them; the codebase uses none.

**A comment claiming an unresolvable place is remembered as unfindable.** The place service stores nothing for an empty answer, which is the opposite — the text is tried again next run.

### Still open

**Two checks the spec says must run against the live map service.** The live run covered outlines for five countries, two states, five cities, a province and a postcode — all present. Not covered: a county, and proof that the outline simplification really shrinks a country's outline.

**Promotion's note at zero**, described above.

## Next Steps

1. **Plan phase 10 — Scoring.** Follow the [phase planning procedure](../docs/features/unified-pipeline/phase-planning-procedure.md). Its r&d file sits in `docs/features/unified-pipeline/phases/`.
2. Phase 10 also owns the four company cleanup rules moved out of phase 9: the ninety-day score removal, the scored date, sweeping companies with no score and no jobs, and the ATS slug exemption. All four read a score column phase 10 creates.
3. Decide whether promotion's note prints when the step has no jobs.
4. Run the two outstanding live map-service checks, if they are still wanted.
