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

**Phase 6, Dedupe, is mid-planning.** Five of fourteen phases are closed. Phase 6 is at step 3 of the [phase planning procedure](../docs/features/unified-pipeline/phase-planning-procedure.md), inside `build-requirements`.

**What is finished.** Discovery is complete — every question the phase raised is answered and written into `phase-06-dedupe-r&d.md`, whose "Still to settle" section is now empty. Fifteen user stories are drafted. A four-agent stress test has run and returned.

**The exact resume point: walking the stress-test findings with the user, one at a time.** Problem 1 of 8 is settled and recorded. Seven remain, plus nine loose decisions and six items to log.

**The working tree is clean.** Three commits pushed this session: `b35f9f5`, `6ec5ed5`, `d5859d3`.

**Verified at close, run fresh.** `npm run lint` exits 0. `npm run test` exits 0 with 1,545 tests across 56 files.

## Completed This Session

**Phase 6 discovery, finished.** All five open questions answered, plus everything the stress test opened. Ten decisions logged, one superseded.

**Live measurements taken**, all recorded in the phase 6 r&d:

- JSearch lists one posting under several links — 13 groups across 60 jobs, 22 redundant, 14 with different links. This refuted a cross-collector guard.
- JSearch's `employer_name` held a real employer 60 times out of 60. The r&d's earlier "4 of 10 job boards" reading does not reproduce; the board is published separately as `job_publisher`.
- Adzuna's company object holds only `display_name` and a type label. No slug, no website, no id.
- Adzuna's link is minted fresh every call — ten jobs compared across two calls, zero stable. The `se` parameter changes; the path does not.
- Stripping the query breaks an Adzuna link: 200 with it, 400 without.
- Link match keys collide nowhere — 210 Adzuna and JSearch jobs, 15 Dribbble links, 177 UI/UX links, all distinct.
- `dev.db` stores dates at midnight, 2,198 of 2,208, so it never recorded a sub-day gap.

**A four-agent stress test**, one per story group, which found eight serious problems.

**One code fix:** the date-pooling comment in `lib/job-merge.ts` claimed the opposite of what the code does.

## Decisions & Context

**Ten decisions are in the feature decision log dated 2026-09-08.** They are not repeated here.

### The eight problems the stress test found

Problem 1 is settled. Seven remain, and each was verified against the code rather than taken on the agent's word.

1. **SETTLED — dedupe would wipe application history.** A job list entry carried a `backlog` status and the three work-done flags into a merge, overwriting an `interview` status and resetting work already done. Fixed at the source: the job list query selects data only. Recorded in the r&d under "Found by the stress test".
2. **A job would delete itself.** On passes two and three every entry is already a saved row, so its own database lookup returns its own row. Nothing says to skip its own id, and the copy-and-delete mechanic then destroys it.
3. **The link match key would go stale.** `lib/job-service.ts` writes rows two ways. `create()` at line 72 goes through `toColumnData`; `writeToExistingRow()` at line 111 does not. A key computed only in `toColumnData` is never refreshed.
4. **An over-merge cannot be audited.** The losing job's values vanish and only the id and matched clause survive. The spec names over-merging as the worst outcome, so the worst outcome is the one that cannot be checked.
5. **A refused delete leaves no trace row.** `lib/steps/save.ts:90` returns `traceRow: null`. **This is a logged decision from 2026-09-06, not an oversight** — it was made when nothing set `delete_on_save`. Dedupe is now the thing that sets it, so the decision wants revisiting rather than fixing.
6. **A failed resolution could merge two different jobs.** `resolved_url_match_key` is deliberately non-unique because several jobs can share one generic careers page — and the same fact means the resolved-link clause, which the spec calls "proof", can fire on that shared page. The fix likely belongs to Phase 7: resolution must not write a URL it never reached a posting at.
7. **Which job survives is not what the decision says.** The 2026-09-07 entry says the source-priority winner keeps its id and that `pickWinner` already computes it. `lib/job-merge.ts:165` reads `existing.id ?? arriving.id` and never consults the winner, so survivorship follows argument order.
8. **A never-saved entry marked for deletion vanishes untraced.** `lib/steps/save.ts:96` returns no trace row, no warning and nothing reported when no row holds the id. The feature spec says such an entry is marked `delete_on_save`; the r&d says it is abandoned. The two disagree.

### Nine decisions the stress test left open

1. What happens when a database lookup returns more than one row, or when two clauses name different rows.
2. Which field decides "older survives" — `created_at`, `collected_at`, or list order.
3. Whether two list entries that both already carry a row fold into one or produce a delete.
4. Which collector goes on the `added_to_job_list` row: the one that first found the stored job, or the one that matched it today.
5. In a chain of three or more, whether a losing job names its immediate partner or the final survivor.
6. What happens when dedupe's own database read throws. Save has a pattern at `save.ts:120`; dedupe has none.
7. How to prove an index exists in a test. This would be the schema's first non-unique index.
8. Which dates feed the 24-hour test when a job already carries both a posted and an updated date.
9. How a three-or-more-way merge breaks a tie, since "the arriving side wins" only settles two.

### Six to log rather than solve

1. A job that finishes parsing never enters a dedupe list again, so a duplicate that slips through is permanent.
2. A job that rejoins mid-pass is never compared against the rest of the list.
3. Chaining pools dates before the database pass runs, widening the range that pass sees.
4. The collector checklist line the r&d promises does not exist in `.claude/rules/source-registry.md`.
5. `absoluteUrl` in `lib/collectors/dribbble-cards.ts` mishandles a `//host/path` link. Unrelated to dedupe.
6. The metric says jobs "deleted" for hard-matching, while most first-pass losers are "abandoned" instead.

### Approaches tried and refused

- **A cross-collector guard on the company-and-title clause.** Refuted by measurement: JSearch lists one posting under 14 different links in 60 jobs, so the guard would keep the duplicates the clause exists to catch.
- **Gating that clause on whether both sides are parsed.** Same 14 duplicates, deferred to resolution instead, so every run pays to follow links it did not need.
- **A named list of junk URL parameters.** Refused as overfitting, per the 2026-08-31 decision against rules fitted to the examples in front of us.
- **Stripping only universal tracking parameters.** Safe but leaves Adzuna's link matching dead.
- **Patching dedupe to drop the status.** Superseded by the better fix at the query.

### Gotchas found this session

- **An async agent's report does not always arrive with its completion notice.** Two of four came through empty. Message the agent and ask it to output the report again.
- **`PIPESTATUS` still does not survive.** Use `cmd > file 2>&1; echo $?`.
- **`.claude/skills/crowd-code`, `start-work-session` and `end-work-session` are symlinks** managed by `sync-workflow`. `git check-ignore` refuses them with "beyond a symbolic link". They are not missing from the commit.
- **The commit hook still prints a false `mergeJobs` test gap.** Known, living with it.
- **`pipeline.db` holds 0 jobs.** The new database has never been run against.
- **The card reader page samples exist** at `lib/collectors/fixtures/`. An earlier r&d line saying otherwise was wrong and is corrected.
- **Live probes cost quota.** Five JSearch calls went out this session. Keys for Adzuna, JSearch, Google Places, Apify and Geocode are all set in `.env`.

### Carried forward, still true

**Dedupe does not exist yet**, so two runs write two rows for one posting.

**Anything new under `lib/steps/` loads two rules** — `.claude/rules/pipeline-steps.md` and `.claude/rules/naming.md`. **Anything touching `lib/collectors/registry.ts` loads a third**, `.claude/rules/source-registry.md`. **A `BACKLOG.md` change needs the user's approval before it is written.**

**Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **`cat` is blocked on any file over 2048 bytes** by a hook. **Vitest output carries ANSI codes** — strip with `sed -e 's/\x1b\[[0-9;]*m//g'`. **`npx tsx -e` cannot run top-level `await`** — probe scripts need a `main()` wrapper.

### Open questions

1. **The live pipeline database is still on the old schema.** Rebuilding is `npm run db:create` then `npm run db:seed`. **The user has been asked five times across sessions and has not answered.**
2. **Whether Phase 11a wants a database reset of its own.** In the phase 11a r&d.
3. **Two backlog candidates await approval** — the Dribbble protocol-relative link bug, and the collector checklist line.

## Next Steps

1. **Walk stress-test problems 2 through 8 with the user, one at a time.** They asked for exactly that pace. Each is written up above with the file and line that proves it. Problem 5 needs framing as revisiting a logged decision rather than fixing a bug.

2. **Settle the nine open decisions.** Most are one line each and can go quickly once the eight problems are agreed.

3. **Put the six log-and-move-on items and the two backlog candidates to the user**, then invoke `add-to-backlog` for whatever they approve. `BACKLOG.md` is never written without their say-so.

4. **Get the fifteen user stories approved.** They are drafted in the conversation and not yet written anywhere. The Links group of six was rewritten after the match-key decision; the Identity, Scope and Tracing groups stand as first drafted. Expect new stories out of steps 1 and 2.

5. **Write acceptance criteria** — `build-requirements` Phase 5, which has not started. The `feature-specs` rule sets their shape and loads once the spec file exists.

6. **Write `phase-06-dedupe-spec.md`** beside the r&d: What We're Building, User Stories, Edge Cases, Acceptance Criteria, Tasks, Approach. Phase 5's spec is the closest model. Then run `spec-review` on it.

7. **Tick "Plan phase 6" in `docs/CURRENT-FEATURE.md`** and put the phase's task list under its build item.

8. **Invoke `wrap-up-planning`**, scoped to Phase 6.
