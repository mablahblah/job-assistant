# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Session Context** section for reasoning that isn't captured elsewhere. The decisions the user made are not in this document — read the feature decision log for those. If a planning conversation was under way, read the meeting notes named in **Current Task** for how it got there.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

- **Feature** - Add External Job Orchestrator, on branch `feature/add-external-job-workflow`. Plan: `docs/features/add-external-job-workflow/feature_spec.md`. Task list: `docs/CURRENT-FEATURE.md`. All six tasks are checked.
- **Shipping is paused at the audit** - `/ship-feature` finished its acceptance criteria check and stopped at its audit step, waiting on which files to audit.
- **Tests** - 4,237 pass, 17 are skipped, none fail. Lint and the type check are clean.
- **Nothing is committed** - This covers this session and the three before it.
- **Changed files this session** - `lib/orchestrators/add-external-jobs-list.flow.test.ts` (a second scenario added).
- **Earlier sessions' uncommitted files** - `scripts/add-external-jobs.ts` and its test; `package.json`; `.claude/skills/add-external-jobs/SKILL.md`; `scripts/retired-commands.test.ts`; `lib/handlers/let-through.ts` and its two tests; `lib/orchestrators/add-external-jobs.ts` and its seven flow tests; `lib/types/added-job-outcome.ts`; `lib/utils/added-jobs-report.ts` and its test; `lib/tools/resolution-browser.fake.ts` and its test; changes to the job service, trace service, their stand-ins and tests, `lib/handlers/dedupe.test.ts` and `prisma/schema.prisma` (a comment only); `docs/BACKLOG.md`, `docs/CURRENT-FEATURE.md`, the plan, the decision log and the meeting notes; the folders `docs/features/collected-at-fallback-later/` and `docs/features/update-job-posting-data/`.

## Completed This Session

- **Acceptance criteria check** - Eight agents checked the spec's 48 live criteria. 47 passed. **One failing link costs only itself** failed: its "fails to save" half had no test through the add run.
- **The missing test** - A second scenario in `lib/orchestrators/add-external-jobs-list.flow.test.ts`, "Adding a list of links where one save fails". It adds three links, makes the save of one fail, and checks the failed link has no job, a warning says it was not saved, and the other two each have their job. All 48 criteria now pass.

## Session Context

- **Decisions** - None new this session. The feature's decisions are in `docs/features/add-external-job-workflow/decision-log.md`.
- **Calls made while building**
  - **The new test has its own scratch database** - It wraps the real job service so `update` throws for one chosen link and passes every other write through.
  - **The test passed on its first run** - `crowd-code`'s flow-test route expects a new test to fail first. That could not happen, because the behaviour already held. Instead every save was briefly made to throw; the test failed; the file was restored.
- **Gotchas**
  - **The audit bookmark is stale** - `history/.audit-checkpoint` still holds `524eab8`, from 2026-09-24. The general purpose parser shipped without moving it. `checkpoint..HEAD` lists about 150 files from two shipped features, ATS parser expansion and the general purpose parser. It also sees only committed work, so none of this feature's files would be audited.
- **Open threads**
  - **Audit scope is unanswered** - The choice put to the user: audit only this feature's uncommitted and new files (recommended), or both lists together. The user asked to clarify the question, then ended the session without saying what was unclear.
  - **Two criteria pass on thin cover** - **A link that fails for good stands** is driven through the add run only for "page not found"; the other four permanent failures are covered by the resolution handler's own tests. **An application is kept** is tested only with `app. sent`, one of five statuses meaning the user applied.
  - **Carried over from the last session** - The report shape is still untested on a real run; flow tests crowding `lib/orchestrators/` is still to be discussed; Adzuna's 65 repost-flagged jobs were not investigated.

## Next Steps

1. **Settle the audit scope** - Ask the user what they wanted to clarify about the audit scope question, then settle it.
2. **Resume `/ship-feature` at its audit step** - The acceptance criteria check does not need running again.
3. **Watch the next real run's report** - On the next `/add-external-jobs`, check the report matches the agreed shape and carries no run summary.
4. **Commit** - Only when the user asks.
