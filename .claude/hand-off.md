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

**Phase 10, Scoring, is built. All 24 tasks are done. The phase is not closed.**

Verified at session end: **2,723 tests pass across 121 files. `npm run lint` exits 0.**

Seven commits were pushed to `feature/unified-pipeline`, `ba89215..4cda7fd`. Everything phase 10 built is committed.

### What is in the working tree

Five files, none of them phase 10 code:

- `docs/BACKLOG.md`, `docs/CURRENT-FEATURE.md` and the feature decision log — this session's own bookkeeping.
- `lib/collectors/fixtures/dribbble.html` and `lib/collectors/fixtures/uiuxjobsboard.html` — **the live run refreshed these itself.** A page-reading collector rewrites its fixture from the last search that returned cards, but only where that search's own self-check passed. This is the designed behaviour, not damage. Commit them or discard them; either is safe.

## Completed This Session

**Tasks 18 to 24 of phase 10, and the first live end-to-end run.**

Scoring now runs. It is two commands, because an agent does the judging and no single command can pause while it thinks.

- `lib/orchestrators/scoring.ts` holds both halves. `runScoringGather` sweeps the backlog, then asks the database for the jobs and employers needing scores. `runScoringSave` takes the answers back, writes them through the two services, and records what became of each entry.
- `scripts/score-gather.ts` and `scripts/score-save.ts` are the two commands, registered as `npm run score:gather` and `npm run score:save`. Save takes `--summary` on the last batch.
- `lib/handlers/company-promotion.ts` gives a well-scoring company's board row the collector that will poll it.
- The run summary gained an alignment scoring block, a company scoring block, and two notes.
- `score-companies` became `score-backlog`, with the company rubric lifted into a file of its own.
- The `job-search` skill runs the pipeline, then scoring, then the viewing server.
- The company and scoring record vocabulary is documented in the `Trace` model comment and in `trace-events.md`, with a guardrail test in `prisma/schema.test.ts`. **That gap the previous hand-off named is closed.**

## Session Context

The decisions the user made are in the feature decision log. **Two entries were written this session**, and one existing entry was superseded.

### Calls made while building

**Promotion fills in a board row that already exists.** Criterion 56 reads as though promotion re-reads the slug out of the resolved link. It does not. Company matching already wrote that row when the posting was parsed, carrying the slug, the company and the parser. The phase spec's Approach section settles it: "Promotion fills it in later, and filling it in is what puts the company on a polling list." So promotion only adds the collector. This needed one new service method, `listForCompany`.

**Scoring writes under one step name, split by subject.** Both halves write under `scoring`, and whether a row names a job or a company is what tells the two populations apart. This mirrors backlog cleanup, which already does the same. Promotion is a separate step, `company_promotion`, because a `promotion` step already exists and means a reposted job returning to the backlog.

**A shared reason needed two event names.** Criteria 17 and 29 both name `scoring_agent_failed`, but the vocabulary rule forbids one reason spanning two populations. The fix was two events — `scoring_failed` for a job, `company_scoring_failed` for a company — so the event carries the split and the summary can count each side.

**The save half looks up the collector.** A trace row about a job must carry the collector that produced it, and an agent's answer carries only an id. So `runScoringSave` reads `findNeedingScores` first and builds an id-to-collector map, rather than trusting the agent to hand the collector back.

**`--summary` was added to the save command.** Nothing else prints a summary once scoring has run — the pipeline prints its own before scoring starts. The flag is passed on the last batch only, because the command runs once per batch and reprinting a growing summary each time is noise.

### Gotchas discovered

**A raw `INSERT` into `Company` or `AtsSlug` must supply `modified_at`.** Prisma's `@updatedAt` has no database default, so a test inserting a row by hand fails the NOT NULL constraint.

**The job-search command does not print its run identifier.** Scoring must carry the same one, and the skill has no way to read it. This run worked around it by reading the identifier out of the `Trace` table by hand. **This is now phase 13's work, recorded in `docs/CURRENT-FEATURE.md` and the decision log.**

**`.serve.json` points at `scripts/serve.ts`, which does not exist.** The only server on disk is `legacy/scripts/serve.ts`, reading the old database. The viewing server cannot show anything this pipeline produces. **This is phase 12's work.**

### Approaches tried and abandoned

**Adding `atsSlugs` to every scoring test call with one sweep.** A bulk edit put the option on four `runScoringGather` calls, which do not take it. Tests still passed because the extra property is ignored at runtime; `npm run lint` caught it. Typecheck is the guardrail here, not the suite.

### What the first live run showed

It ran about 55 minutes, almost all of it following links in a browser.

- 376 jobs collected, 313 saved, 162 resolved, 170 parsed, 169 classified.
- Only 20 jobs reached scoring — a 5% yield. 88 of the classified jobs expired on arrival, which is what a fresh database collecting old postings does once.
- 110 jobs could not be parsed. Four platforms account for 77: Workable 32, AIApply 24, Workday 13, SmartRecruiters 8. No parser exists for any of them.
- 27 employers were researched, one helper each. 20 came back fully scored, 7 partially, because a category had nothing public behind it.
- **Promotion fired correctly on real data.** Impinj and Virtualitics cleared the threshold and joined a polling list. 24 fell below it, 1 had no board we can poll.
- jsearch raised one warning: `JSearch local search failed: Network timeout after 15s`.

### Open questions

**Phase 10 is built but not closed.** Closing updates the architecture doc, runs `/update-decision-log`, and presents any `BACKLOG.md` change for approval.

**The two summary shapes are now phase 14.** Collection, dedupe, resolution and parsing print a label and loose bullets. Everything else follows the run-summary rule. Read together they look like two different programs. This was backlog item 30; the entry was removed from the backlog and its r&d file stays at `docs/features/summary-format-rollout/feature_r&d.md`.

## Next Steps

1. **Decide what to do with the two refreshed fixtures** in `lib/collectors/fixtures/`. The live run rewrote them. Commit or discard.
2. **Commit the three documentation files** still in the working tree: `docs/BACKLOG.md`, `docs/CURRENT-FEATURE.md` and the feature decision log.
3. **Close phase 10.** Update `docs/features/unified-pipeline/architecture.md` to describe scoring as built — the two-starting-point orchestrator, the promotion handler, the ATS slug service's `listForCompany`, and the two new commands. Then present any backlog change for approval.
4. **Plan phase 11, Work log & enrichment**, following the phase planning procedure.
5. **Consider a parser for Workable.** It cost 32 jobs in one run, more than any other platform. This is a judgement for prioritization, not a decision already made.
