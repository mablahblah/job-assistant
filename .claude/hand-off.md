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

**Phase 1 (Collection) is fully planned. Nothing is built.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **Build phase 1 — Collection**, task 1.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md` — 66 stories, 73 acceptance criteria, 14 ordered tasks, the regression net, and the approach. Read it with `phase-01-collection-r&d.md` beside it, which carries the brain dump, what planning settled, and everything measured live.

Working tree is clean. Everything is committed and pushed through `f213bbc`.

## Completed This Session

Phase 1 planning, start to finish: brain dump, thirteen uncertainties discussed one at a time, three questions answered by live investigation, a four-agent stress test producing roughly sixty findings, a spec review, and the full wrap-up.

Meeting notes were split into one dated file per session under `meeting-notes/`, since a single file would grow across thirteen phases.

The phase planning procedure gained a brain-dump step and a discuss-uncertainties step, and stopped naming tests during planning.

Sixteen decisions were added to the log and four items were filed to the backlog.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. Not repeated here.

Two prerequisites the build will trip over:

- **`stemmer` is not installed.** AC 43 and task 6 name it; `package.json` has no text-processing dependency. It was tested in a scratchpad only. It would be the project's first such dependency.
- **`PIPELINE_DATABASE_URL` exists nowhere** — not in `.env`, not in `.env.example`. Until task 1 creates it, every Prisma command on this branch still resolves to `dev.db`, the database real job searches use.

Two working gotchas:

- **The spec's criterion numbers are cross-referenced** by the Tasks list and the Edge Cases table. Inserting a criterion shifts everything after it and silently breaks those references. It happened twice this session; both were caught only by checking each reference's text against what it claimed. Repair references after any renumbering.
- **Playwright diagnostics cannot run from the scratchpad.** `tsx` resolves `node_modules` from the script's location, so a diagnostic must live in the repo root. Use a dot-prefixed temp file and delete it after.

Approaches tried and dropped:

- **Saved page fixtures alone** were rejected — a saved copy cannot drift, so it cannot catch drift. Replaced by a fixture that refreshes only after a clean run, paired with a self-check inside the collector.
- **Card extraction of location, work mode, and salary** was agreed and then reversed. Collectors do not parse; the browser collectors gain only the title.
- **Tracking every collector's attendance** in the orchestrator's return value was dropped. Absent errors already mean success, and Phase 2 owns the durable version.

No open questions remain for Phase 1. Carried-in items wait in the r&d files for phases 2, 4, 5, 7, 8, 9, and 11.

## Next Steps

1. **Task 1 — separate the database.** Do this before anything else; it is the only task whose omission is unrecoverable. Point `prisma.config.ts` at a schema outside `legacy/` and at `PIPELINE_DATABASE_URL`; add that variable to `.env` and `.env.example`; confirm the new file is untracked and `dev.db` is unchanged. — AC 1–3
2. **Task 2 — schema and create command.** Every collector-written field nullable or defaulted; list fields as `Json`. — AC 4–5, 17, 26
3. **Task 3 — seed script**, then **task 4 — settings service**. Tasks 5 through 14 follow in the spec's order, which puts the working collectors before weLoveProduct and Ashby.
4. Each task is built test-first. Invoke `test-driven-development` before writing implementation code — the acceptance criteria are the test list.
