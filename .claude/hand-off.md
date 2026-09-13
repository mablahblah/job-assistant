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

**Phases 8 and 8b are both closed. Phase 8a is next and not yet planned.**

Verified at session end: **2,229 tests pass across 97 files. `npm run lint` exits 0.** Working tree clean, everything pushed to `feature/unified-pipeline`.

Phase 8a sorts `lib/`. Forty-three files sit flat at the top of it while every kind that earned a folder has one. Sorting them rewrites an import path in all forty-three. The user wants this done "quickly".

## Completed This Session

**Phase 8b's outstanding review, against its 47 acceptance criteria.** Four problems found and fixed, in commit `97d62d3`.

- Criterion 45's test proved nothing. It left the three lane settings at their defaults, then checked they still held the defaults, so it passed whether or not the seed overwrote them.
- Criteria 14, 15 and 16 had no test at all. Nothing checked what a run does when the database does not match the code.
- Criterion 39 had none either.
- `scripts/.experiment.tmp.ts` had been committed. Its own first line said "Throwaway".

Each new test was proven to catch its fault. The code it guards was broken on purpose, the test watched to fail, then the code restored.

**A real bug, found by the user watching a live run.** Fixed in commit `2ff5859`.

A full job search collected 398 jobs. During resolution the user saw full-page 403s from Adzuna going past. The database recorded zero refusals for Adzuna.

The cause came from a console line the user pasted. Adzuna redirects a job link to a second address carrying a token. That address answers 403. Adzuna then sends the browser somewhere that answers 200. `lib/resolve-job-url.ts` read only the status of the address the page settled on, so the refusal was invisible and the host was never slowed down.

The fix spans three files, each built through `crowd-code` with two competing writers.

- `lib/resolution-page.ts` — `ResolutionResponse` gained `request(): { isNavigationRequest(): boolean }`.
- `lib/resolution-page.fake.ts` — a `ScriptedResponse` type whose `isNavigation` defaults to true.
- `lib/resolve-job-url.ts` — `chainWasRefused`, checked before the settled-page status check.

Only a page the browser navigated to counts. One measured page load fires about 69 responses, mostly images, scripts and advertising pixels. Criteria 48 to 51 were added to the 8b spec.

**A second run proved it works.** Run with `npm run job-search -- --limit 0`, which skips collection and resolves the 209 jobs already stored.

| Host | Resolved | Final refusals |
| --- | --- | --- |
| uiuxjobsboard | 84 of 91 | 0 |
| Adzuna | 57 of 61 | 0 |
| LinkedIn | 0 of 37 | 0, all login walls |
| ZipRecruiter | 1 of 7 | 6 |
| CareerBuilder | 0 of 6 | 6 |

149 resolved, 60 failed. **Adzuna resolved 57 of 61, against 19 of 66 before the fix.** It refused us again, was moved to the slow lane, and finished nearly everything. Three hosts were caught and slowed rather than spent.

Parsing: 173 parsed, 91 not. The domains with no parser are Workday 22, Workable 16, SmartRecruiters 9, `join.com` 5, Adzuna 4.

**Both closes.** The architecture doc gained nine missing parts, a rewritten Status section, updated Data Model rows, and phase 8's ported-from-legacy row. The `Trace` comment's own counts were stale and now read correctly — resolution has ten reasons, not eight. The decision log gained six entries. `docs/CURRENT-FEATURE.md` has both closes ticked and phase 8's 22 sub-tasks collapsed into one line.

**Backlog changes, all approved by the user.**

- **Item 1, Unified Pipeline Tech Debt** — new, at the top. A running list for real but non-critical defects found mid-phase.
- **Item 27, Resolver Refinements** — its circuit breaker is retired, because phase 8b built it as the two lanes. It gained the JSearch question instead.
- **Item 28, Lean Resolution Page Loads** — new. One page visit costs 69 requests against a ceiling of roughly 25.

Every existing item shifted down one. Four documents naming a backlog number were updated. Meeting notes keep their original numbers, being dated records.

## Decisions & Context

### What the user decided

Six entries were appended to `docs/features/unified-pipeline/decision-log.md`. Read them there. In short: a refusal is read from any page the browser navigated to; a refused tracker is not a refusal; the fast lane stays unpaced because the slow lane exists so it need not be; cutting what a page visit costs becomes its own backlog item; and a non-critical defect goes on the tech debt list.

**The fast-lane question is now closed, not deferred.** The 8b spec previously said it was "to be decided against a run of the shipped code". That run happened. The user's words: _"this is why we built the slow lane, so we didnt have to slow the fast lane."_

### Rejected — do not re-raise

**Flagging the over-merge query as owed.** The user's words: _"not sure this is a worry of mine, borrowing a problem from the future."_

### The subtlety that will mislead the next session

**A job deferred to the slow lane writes no trace row in the fast lane.** This is by design, so each job earns exactly one row.

So a host being refused looks like **zero `page_refused` rows, plus that host disappearing from the browser**. A monitor watching for refusal rows to detect a block is watching the wrong signal. This session built exactly that monitor and it reported "adzuna refusals=0" throughout, while the slow lane was working perfectly.

What actually reveals a deferral is a host stopping partway through its queue with no failure recorded.

### Measured facts — do not re-measure

- **One Adzuna page visit fires about 69 responses.** The posting, plus images, scripts, fonts and advertising pixels — `us.creativecdn.com`, `px.ads.linkedin.com`, `linkedin.com/px` among them. This is what backlog item 28 exists to cut.
- **Adzuna's block lifts on its own.** A three-link probe mid-session returned three clean 200s and resolved all three.
- **A three-request probe proves nothing about a rate limit.** The ceiling needs roughly thirty visits in five minutes. The user's words: _"you probably didnt hit the limit."_
- **LinkedIn is not a refusal case.** Its 37 JSearch jobs end at a login wall, recorded as `dead_end`. That is correct and pacing will not change it.

### Calls made while building

- **The collector fixture HTML files were reverted.** A real run refreshes `lib/collectors/fixtures/dribbble.html` and `uiuxjobsboard.html`. They are unrelated to a bug fix and should not be swept into one.
- **The second test run skipped collection.** `--limit 0` reaches no job site, so resolution ran against the 209 jobs already stored. This isolated the fix from another collection pass.
- **New criteria were appended as 48 to 51.** The 8b spec's own rule is that numbering never shifts.

### Gotchas discovered

- **`pkill -f "scripts/job-search.ts"` did not stop the run.** The processes survived it. `kill -9` on the listed PIDs was needed.
- **The pipeline database is `pipeline.db` at the repo root**, reached through `PIPELINE_DATABASE_URL`. `dev.db` beside it belongs to the old pipeline.
- **`sqlite3` is available on this machine** and is far cheaper than spawning `npx tsx` to query the database.

### Open question, unanswered

**Should the Future Ideas list in `docs/BACKLOG.md` be renumbered?** It numbers itself from 26 upward and now collides with the Upcoming list's 26, 27 and 28. The overlap existed before this session at one number and is now three.

### Still open from earlier hand-offs

1. **`.claude/CLAUDE.md.bak` and `.claude/session-status.md` are tracked and pushed.** Unanswered for thirteen sessions.
2. **Whether resolution should stop on its own aggregator** is still undecided.
3. **Whether `.claude/rules/naming.md`'s Tools section should record that a stateless tool can be a plain function**, rather than a `create{Subject}()` builder. The page fetcher is such a tool and the decision is already logged, but the rule does not mention the exception.

## Next Steps

1. **Plan phase 8a, sorting `lib/`.** Follow the phase planning procedure. Forty-three files sit flat at the top of `lib/`, and sorting them rewrites an import path in all forty-three. The user wants it done quickly.
2. **Build phase 8a**, then close it.
3. **Answer the Future Ideas numbering question** before the next backlog change, since another insertion widens the collision.
4. **When a non-critical defect turns up, add it to backlog item 1** rather than fixing it mid-phase or carrying it in a hand-off. Its first entry is the lost trace row: `lib/trace-service.ts` counts a failed write and throws the error away, so the one row lost on 2026-09-13 cannot be explained. The leading suspicion is SQLite write contention between the three fast-lane workers.
