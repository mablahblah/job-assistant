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

- **Feature** - General Purpose Parser Safety Net. Planning is finished and building has not started. The spec is `docs/features/general-purpose-parser/feature_spec.md`: 8 stories, 51 criteria, 8 flow tests and 9 tasks, all unchecked in `docs/CURRENT-FEATURE.md`.
- **Branch** - `feature/general-purpose-parser`, created from an up-to-date `main`. Nothing on it is committed.
- **Uncommitted from this session** - `docs/CURRENT-FEATURE.md`, `docs/BACKLOG.md`, `docs/features/general-purpose-parser/` (discovery file, spec, decision log, meeting notes), `docs/features/dead-postings-stay-expired/`, and `docs/features/summary-format-rollout/feature_r&d.md`.
- **Uncommitted from before this session** - `docs/features/_complete/ats-parser-expansion/decision-log.md` holds one entry added after that feature merged. It was meant to be committed on `main`, and it came along to this branch uncommitted.
- **Leave alone** - `docs/features/forgiving-job-lookup/` and `docs/research/resume-review/` are untracked and predate this work.
- **Tests** - 4,021 pass and 17 are skipped. No code changed this session.

## Completed This Session

- **Planning** - `plan-feature` ran end to end. The decisions are in `docs/features/general-purpose-parser/decision-log.md`, and the conversation is in `meeting-notes.md` beside it.
- **Measurements** - The discovery file holds today's measurements: 143 stuck jobs, 75% of live pages carrying search-engine job data, and what general rules read from page text.
- **Backlog** - New entry **Dead Postings Stay Expired**, placed after Repost Handling with no size tag yet. A note about breaking the parsing summary down by parser was added to **One Shape for Every Summary Block**.

## Session Context

- **Measuring scripts were deleted** - They ran from a folder hidden from git, which was removed afterwards. Their results live only in the discovery file.
- **The parser contract needs one more answer** - A parse today returns fields or throws. The general parser also has to say "this posting is dead". The parsing step also forces a job's status back after every read, so it cannot currently set `expired`. The spec's Approach covers both.
- **Readability is not a dependency yet** - The page-text reader relies on Mozilla's `@mozilla/readability`. Version 0.6.0 was tested against `linkedom` and worked.
- **Sub-agents stop at 20 steps** - All three stress-test agents hit the limit before reporting, and each had to be asked to report what it had.
- **Spec review took four grading passes** - The fixes corrected each flagged criterion, but never swept for the same problem elsewhere. When a review flags a pattern, fix every instance at once.
- **Open thread** - The user wants the spec-review skill to be more specific about what triggers another grading pass. Proposed: only a change adding a requirement nobody has reviewed, never a split or a rewording. It is recorded in the meeting notes under Open Questions.
- **cachebeat hook** - The previous hand-off reported a syntax error. This session, the hook armed and logged timers normally.

## Next Steps

1. Commit the planning documents on `feature/general-purpose-parser`. Commit the ATS parser expansion decision-log entry separately, since it belongs to the shipped feature.
2. Run `/start-work-session` to begin the **Write the flow tests** task in the spec.
3. When convenient, update the spec-review skill's rule for when a new grading pass is needed.
