# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Session Context** section for reasoning that isn't captured elsewhere. The decisions the user made are not in this document — read the feature decision log for those.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

**Phase 13, migration and switch over, is planned and not built.** The spec is written and approved: `docs/features/unified-pipeline/phases/phase-13-cutover-spec.md` — 13 stories, 17 edge cases, criteria 180 to 254, 15 tasks. Nothing is committed. Seven files carry this session's work: five modified (backlog, tracking file, decision log, feature spec, the phase r&d file) and two new (the spec, the meeting notes).

The suite was verified green at session end: 150 files, 3,229 passed, 17 deliberately skipped.

## Completed This Session

One unit: the whole planning cycle for phase 13. Brain dump, orientation, discovery, a three-agent stress test with every finding re-verified against code and both live databases, criteria drafted and agent-graded twice, the spec assembled and approved through spec-review, and the full wrap-up — meeting notes, ten decision log entries, feature spec correction, backlog item 33.

## Session Context

The user's decisions are in the feature decision log, all dated 2026-09-17. Read them there.

**Phase 12 was closed by a parallel session while this one planned.** Its close and commit are already on the branch. Do not look for phase 12 work here.

**Measurements are already taken — do not re-measure.** The r&d file's stress-test section holds the verified facts: the live new database's test contents and collisions, the work log's date divergence (21 of 70 entries would misfile by week), the old database's counts. All counts go stale by design; the migration counts live.

**A gotcha with the question tool.** A project hook blocks every tool call after a multiple-choice question until the user's next real message — even after they answer the question itself. Ask questions in plain text in this project.

**Criteria are referenced by title, never number.** The spec rubric enforces it; this spec's tasks already comply. The phase 12 spec predates the enforcement — do not copy its numbered style.

**One approach was abandoned.** A rebuild guard that reads the data (refuse when work log entries exist) was dropped as brittle at the user's call; the built design is path-scoped instead. The migration script itself still uses the content check, where it is correct.

**Write plainly.** Carried from the last hand-off and reinforced once this session: short sentences, the literal thing named, technical names explained beside their use.

## Next Steps

1. **Commit the planning work.** Seven files, one unit: phase 13 planned.
2. **Build phase 13, task by task, test first.** The task list is in the spec and mirrored in `docs/CURRENT-FEATURE.md`. Task 1 is the rebuild command's target guard. Task 15's runbook and hand checks come last and need the user present.
3. **At phase close, correct the architecture doc.** It says all three database commands retire at the switch over; only the reset script does. This is recorded in the r&d file's dropped-findings section.
