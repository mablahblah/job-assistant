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

Feature: **Unified Job Pipeline** — one feature, thirteen phases, on the long-lived branch `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

Planning is finished and closed out. No pipeline code exists. The next unchecked item in `CURRENT-FEATURE.md` is **Plan phase 1 — Collection**.

Nothing is committed. Last commit `b0c9fbb`. Everything modified or added is documentation.

## Completed This Session

`spec-review` and `wrap-up-planning` both ran, which were the two steps blocking the build.

The feature spec gained an **Architectural Constraints** section that outranks the stories beneath it, and a **Vocabulary** section. Eleven decisions were added to the log. Meeting notes now carry a Session 2 covering this conversation.

Phase files were restructured: each phase has an r&d file from the start (`phase-{nn}-{name}-r&d.md`), and its spec is written beside it at planning time. Every phase-specific open question moved out of `feature_spec.md` and `feature_r&d.md` into the phase that owns it.

Backlog: Update Job Workflow and Add External Job Workflow added as items 1 and 2 with r&d files; External Jobs Workflow deleted as outdated; two Future Ideas deleted, one a duplicate of the Tracking Dashboard and one already working.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. Not repeated here.

Context that is not a decision:

- **Open questions live in the phase that answers them**, in `phases/phase-{nn}-{name}-r&d.md`. Never in `feature_spec.md` or `feature_r&d.md`. Phase 1 planning reads Phase 1's r&d and nothing else's.
- **The architectural constraints outrank the stories.** A story that cannot be built without breaking one is the story that gives way.
- **`dev.db` at the repo root is the live database.** Untracked, so it survives branch switches.
- Backlog items the spec already covers — weloveproduct Collector Reliability, Ashby API Collector, Company Scoring Improvements, ATS Company Graduation — stay on the backlog until the work is actually built. The backlog is swept once after Phase 12, against what shipped rather than what was planned.

Unresolved, each recorded in the phase that owns it:

- **Phase 2** — whether tracing is a seventh singular service, and what shape it takes.
- **Phase 3** — how company name normalization works, and where the normalized name lives on an unsaved Job List entry.
- **Phase 4** — parsed against unparsed in the merge.
- **Phase 5** — the repost cut-off, missing posting dates, and the company-and-title clause firing regardless of URL.
- **Phase 6** — what safeguards an unbounded hop walk, and what an update-job fix writes.
- **Phases 7, 8, 9, 11** — one question each. Phases 1, 10, and 12 have none recorded.

## Next Steps

1. Commit the planning docs.
2. **Plan phase 1 — Collection.** Run `phase-planning-procedure.md` against `docs/features/unified-pipeline/phases/phase-01-collection-r&d.md`. Phase 1 builds the search orchestrator (collection only — later phases add their steps), ports the seven collectors and `fetch-utils`, and builds the Ashby collector new. Prisma setup for the new database lands here too.
3. Then **Build phase 1**.

The FigJam is linked from `feature_spec.md` under Related Documents.
