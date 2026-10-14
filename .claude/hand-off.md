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

- **Feature** - Repository Ready to Go Public, `minor`, `M`, on branch `feature/personal-details-in-database`. Docs: `docs/features/repository-ready-to-go-public/` — `feature_discovery.md`, `decision-log.md`, `meeting-notes.md`, `feature_spec-draft.md`. No written spec yet.
- **State** - Planning is inside `/plan-feature` Phase 7, step 8: `spec-review`, Phase 2. The reviewer's findings are applied to `feature_spec-draft.md`, except one: whether the backup task needs a criterion of its own. That question was asked and not answered.
- **Planning conversation interrupted** - Yes. Meeting notes: Sessions 1 to 3, all marked hand-off. The next session adds Session 4.
- **Tests** - 4,268 pass, 17 are skipped, none fail.
- **Git** - Nothing committed. The tracked files changed are `.claude/hand-off.md`, `.gitignore`, `docs/BACKLOG.md`, `docs/CURRENT-FEATURE.md`, `docs/features/dead-postings-stay-expired/feature_discovery.md` and `docs/features/settings-page/feature_r&d.md`. The feature's own docs sit under the ignored `docs/features/`.

## Completed This Session

- **Requirements check settled** - Every finding is settled, with answers recorded in the discovery file.
- **Feature renamed** - The folder moved, and every link to it was updated.
- **Acceptance criteria** - The user approved 38. They are in the discovery file.
- **Draft spec** - Assembled, traced by `check-plan-works` ("Plan Check, 2026-10-12" in the discovery file), graded once by `spec-review`, and corrected. It now holds 46 criteria and 11 tasks.
- **Meeting notes** - Session 3 was written.

## Session Context

- **Decisions** - In `docs/features/repository-ready-to-go-public/decision-log.md`. Smaller answers sit under each finding in the discovery file.
- **The conversation** - In the meeting notes named above.
- **How the user wants settled answers applied** - By their purpose, not their exact wording. Details inside a settled answer need no approval. Anything that changes what was settled goes to the user. The user was frustrated when Claude held to the wording of the resume-path answer.
- **The user's feedback** - The planning felt brittle. This feature may not have needed planning this way, rather than focusing on the functional pieces. The user asked for no process change yet.
- **The draft is the current version of the criteria** - The discovery file holds the 38 approved criteria. The draft has the splits the review asked for, bringing it to 46.
- **This file is public** - `.claude/hand-off.md` is tracked, so it must never name the real zip, its coordinates, the personal email or the phone number.
- **Search gotcha** - In this shell, `grep` is a function that skips files Git ignores. Use `command grep` for the planning docs.
- **Drafts on disk** - `check-plan-works` and `spec-review` say not to write the draft to disk. The user's global rule puts drafts beside the file as `{filename}-draft.md`, so the draft lives there.

## Next Steps

1. **Settle the backup question** - Ask whether the backup task stays as safety work with no criterion (recommended), or gets the criterion "The old history can be recovered."
2. **Finish `spec-review`** - Criteria were added, so self-check the corrected draft against the rubric and the `feature-specs` rule, then grade it again. Resolve any new findings by the same standard.
3. **Write the spec** - With the user's approval, write `feature_spec.md` and delete `feature_spec-draft.md`.
4. **Close planning** - `/plan-feature` Phases 8 and 9. Put the task list in `docs/CURRENT-FEATURE.md`, delete `history/history-scrub-checklist.md`, and run `wrap-up-planning`, which writes Session 4 of the meeting notes.
5. **Start building** - With `/start-work-session`, beginning with "Write the flow tests."
