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

**Phase 8 is built. Phase 8b is built and specified. Neither is closed.**

The user's words for what comes next: *"I want to pick back up on 8b, so i can finish this review and close it, then close 8, then do 8a quickly."*

Verified at session end: **2,219 tests pass across 97 files, `npm run lint` exits 0.** Working tree clean, nothing uncommitted, no unfixed failures.

Phase 8b was built before it was specified — a live test run of phase 8 exposed three faults serious enough to fix on the spot. Its spec is now on disk at [phase-08b-resolution-pacing-spec.md](../docs/features/unified-pipeline/phases/phase-08b-resolution-pacing-spec.md) with 47 acceptance criteria, written from what was built and what was measured.

## Completed This Session

**Phase 8 tasks 19 to 22, finishing its build.**

- The run summary gained a Parsing block: how many parsed, how many did not, and the top five failing domains with a count and a label each.
- The four parsers joined the seeded source priority list.
- Parsing's vocabulary went into the `Trace` model comment and `trace-events.md`.
- `.claude/rules/naming.md` gained a Parsers section.

**Phase 8b, all of it.** Three faults, each fixed:

1. **Every resolution failure parked its job** as `unresolvable`, which takes it off the queue for good. A live run had parked **100 of 334 jobs** that way — 47 Adzuna, 47 JSearch, 6 UIUXJobsBoard. Now `page_refused` and `page_load_failed` keep the job; everything else still parks it. `page_unavailable` split in two to make that distinction possible.
2. **A whole run's trace was lost silently.** `Trace` gained a `domain` column in phase 8 and the live database never got it, so every trace write failed, was caught, counted, and reported only in a line at the end that a stopped run never reaches. `lib/schema-check.ts` now stops a run before anything else when the two disagree.
3. **Nothing paced our requests.** Resolution now runs two lanes, with the queue dealt round-robin by host in `lib/interleave-by-host.ts`.

**Reviewed as if it had been planned.** Two stress agents attacked the design and checked every criterion against the tests. Three false claims in the spec were corrected and five test gaps closed. A technical writer then graded the spec against the rubric, and its findings were resolved.

Thirteen commits, `30f3854` to `6ddcb59`.

## Decisions & Context

### What the user decided

Four entries appended to `docs/features/unified-pipeline/decision-log.md`, all dated 2026-09-12. Read them there. In short: a failure that describes the moment keeps the job; no retry limit; a run stops when the database and code disagree; resolution runs two lanes.

**The two-lane decision is the one that constrains future work.** Giving each host its own pace was rejected as routing by URL — domain-specific judgement belongs in collectors and parsers and nowhere else.

### Dropped as work-documentation, not decisions

- **The three lane settings.** The reason is self-evident, so the entry would read the same without it.
- **Rebuilding the database rather than un-parking 100 jobs.** A one-time cleanup that constrains nothing later.
- **The source priority order.** The user was explicit: *"this is not a decision, there is no decision about order."* Only two things are true, and both are already in the 2026-09-06 entry — new sources get added to the list, and the list is theirs to reorder.

### Measured facts — do not re-measure

- **Adzuna allows roughly 20-25 page visits per five minutes and refuses at about 30.** Measured three ways over 66 jobs. The full tables are in the spec's "What was measured".
- **One at a time resolved 46 of 66. Every 7s resolved 34. Every 5s resolved 31.** The shipped 3-at-a-time-with-no-delay resolved 19.
- **The block lifts on its own** after a few minutes. Every paced run recovered for stretches of 8 to 13 clean requests.
- **JSearch's 51 jobs point at 36 LinkedIn, 10 ZipRecruiter, 5 CareerBuilder.** LinkedIn's login wall reads as `dead_end`, correctly. Its parked jobs are mostly right and pacing will not change them.
- **A refused page burns the full 15-second settling budget** before its status is read, because a 403 page carries too few links to look finished.

### Known limit, recorded in the spec

**The fast lane has no pacing at all.** A host above roughly a sixth of the queue still breaks through; Adzuna is 30%. The two lanes cut the cost of a block, they do not prevent one. Whether the fast lane should be paced is the next iteration, to be decided against a run of the shipped code rather than in advance.

### Gotchas discovered

- **`npm run db:seed` appends to the bottom and never reorders.** Running it on a database that already holds a priority list will not fix that list's order.
- **The database was rebuilt from scratch this session** and holds no jobs.
- **The scripted resolution page fake ignores the URL it is handed** and serves its pages in order. A test covering several jobs on different hosts needs `factoryByUrl`, added in `lib/handlers/resolution.test.ts`.
- **`pkill -f "scripts/job-search.ts"` does not always take the Playwright browser with it.** `pkill -f "playwright_chromiumdev_profile"` finishes the job.

### Two review findings the user dismissed — do not re-raise

- **The run-summary constraint.** Every phase is supposed to add a summary block; 8b adds none. The user's words: *"This isn't true."*
- **A claimed contradiction with the seed.** The grader read the hand-written ranking as overturning a signed-off decision. Checked against the code: the seed still appends to the bottom and never reorders. No contradiction.

### Open question, unanswered for two sessions

**Should the Tools section of `.claude/rules/naming.md` record that a tool holding no state can be a plain function rather than a `create{Subject}()` builder?** The page-fetcher is such a tool, and the decision is already in the log, but the rule does not mention the exception.

### Still open from earlier hand-offs

1. **`.claude/CLAUDE.md.bak` and `.claude/session-status.md` are tracked and pushed.** A `git add -A` swept them in. Unanswered for twelve sessions.
2. **The over-merge query backlog entry 26 owes has not been run.** Its trigger, the first real run, has happened.
3. **Whether resolution should stop on its own aggregator** is still undecided.

## Next Steps

1. **Finish reviewing phase 8b.** The spec is on disk with 47 criteria. A code review of the build against those criteria has not been run — that is the one review step still outstanding.
2. **Close phase 8b** — architecture doc, and any `BACKLOG.md` change presented for approval. The decision log is already done.
3. **Close phase 8** — same. The source priority ranking work belongs to this close rather than to 8b, which is why 8b's spec carries none of it.
4. **Phase 8a, sorting `lib/`.** Plan it, then build it. Forty-three files sit flat at the top of `lib/`, and sorting them rewrites an import path in all forty-three. The user wants this done "quickly".
5. **Rerun the Adzuna measurement against the shipped two-lane code**, to see whether it beats 19 of 66. The database holds no jobs, so this needs a collection run first.
