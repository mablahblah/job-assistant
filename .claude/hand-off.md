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

**Feature:** Update Job Entries (`minor` `L`) — `docs/features/update-job-entries/feature_spec.md`. Eight tasks. Branch `feature/update-job-entries`.

**In progress:** Task 1 of 8, **Extract Reusable Pipeline Helpers**. Planning is finished and approved. **No code has been written** — the next session starts implementation from a rails-grade plan.

- Spec: `docs/features/update-job-entries/task_extract-reusable-pipeline-helpers/task_spec.md`
- Plan: `docs/features/update-job-entries/task_extract-reusable-pipeline-helpers/task_plan.md` — six sub-tasks, TDD, one commit each
- Meeting notes: `docs/features/update-job-entries/task_extract-reusable-pipeline-helpers/task_meeting-notes.md`

**What the task builds:** three modules that give one home each to facts currently duplicated — `lib/parsers/register-all.ts` (`registerAllParsers()`), `lib/shared-utils/has-field-value.ts` (`hasFieldValue()`, renamed from `dedupe.ts`'s private `hasValue()`), and `lib/shared-utils/job-status.ts` (all ten statuses, grouped, plus three predicates). Seven files drop local copies; three docs get repointed. The only behavior change anywhere is `scripts/pipeline.ts` gaining the `adzuna` and `dribbble` parsers it was silently missing.

**Modified files, this session:**

| File | Status |
|---|---|
| `docs/features/update-job-entries/` | Untracked, all new — task spec, plan, meeting notes, feature spec, decision log |
| `docs/features/code-health/feature_r&d.md` | +3/−2 — added **Repository does not typecheck** task |

**In flight from earlier sessions, unrelated:** `.claude/skills/process-search-issues/SKILL.md`, `.claude/skills/self-document/SKILL.md`, `docs/search-issues.md`, `docs/features/company-scoring-improvements/feature_r&d.md`, `docs/BACKLOG.md`, `docs/CURRENT-FEATURE.md`. `.codegraph/` self-ignores and is not work in flight.

## Completed This Session

- Designed and specced Task 1; wrote the six-part implementation plan
- Reconciled `feature_spec.md` — `hasValue()` → `hasFieldValue()`, status-module consumers widened from three files to five, task spec and plan linked into the Tasks entry
- Decision log now at 22 entries: 3 new for this task, 3 backfilled that were missing from feature planning (invocation shape, unknown-geocoding-class handling, `register-all.ts` placement), 1 superseded
- Filed the repository's typecheck debt to Code Health
- Fixed a stray `y` byte corrupting line 1 of `feature_spec.md`

## Decisions & Context

Decisions are in `docs/features/update-job-entries/decision-log.md`. What follows is context that lives nowhere else.

**Verification gotchas, both load-bearing for the plan:**

- **Do not gate on `npx tsc --noEmit`.** The repository does not typecheck clean — pre-existing errors in `lib/dedupe.ts` (3), `lib/url-resolver.ts`, `lib/url-resolver.test.ts`, `lib/scraper-save.test.ts` (10), `scripts/geocoding-spike.ts`, and several `lib/scrapers/` files using DOM globals without the `dom` lib configured. Nothing gates on `tsc`, which is why it went unnoticed. Now a Code Health task.
- **`npm run lint` baseline is 0 errors, 1 warning** — `lib/parsers/lever.ts:90`, dead `browser` argument, already filed to Code Health's "Small fixes". Lint is the gate; that warning is not a regression.

**Structural facts that shaped the design:**

- **`lib/pipeline.ts` is imported by nothing but its own test.** `/job-search` and `/add-external-jobs` reach `runPipeline` through an inline `import` in a tsx script and rely on import-time registration. This is why `registerAllParsers()` must stay at module top level and must not move inside `runPipeline()`.
- **`lib/parsers/greenhouse.ts` and `lib/parsers/lever.ts` transitively import Prisma** via `lib/parsers/company-cache.ts`, which constructs a client at import time and fails under Vitest. Any test importing them must `vi.mock("@/lib/prisma")` first — `lib/parsers/greenhouse.test.ts:4` is the existing pattern.
- **Active and replaceable statuses are exact complements** of the ten in `prisma/schema.prisma:44`. `scripts/serve.ts:48` holds a third grouping, "disqualified" = replaceable minus `backlog`.

**Nothing was tried and abandoned.**

**Open threads:**

- The user is fixing global `ROADMAP.md` references. In this project ROADMAP.md means BACKLOG.md. Four global files hardcode the path: `~/.claude/skills/wrap-up-planning/SKILL.md:42`, `~/.claude/skills/init-project/SKILL.md:32`, `~/.claude/workflow-profiles/rocket-ship/skills/plan-feature/SKILL.md:33`, `~/.claude/rules/roadmap.md:2`. Three other projects still hold a real ROADMAP.md, so removing the concept globally would break them.
- `docs/CURRENT-FEATURE.md` does not link the task docs. The backlog rule says relevant feature docs are linked there as they are created; the feature spec links them instead. Possibly intentional — raised, not acted on.
- **Orphaned company rows** after a job re-points are recorded as out of scope in the feature meeting notes, deferred to "a future job that cleans out old company rows." No such job exists in the backlog. Known and accepted.

## Next Steps

1. **Run `/start-task`** for Extract Reusable Pipeline Helpers.
2. **Execute `task_plan.md` with `subagent-driven-development`**, in order — the plan commits after each sub-task:
   1. `hasFieldValue()` + point `lib/dedupe.ts` at it
   2. `lib/shared-utils/job-status.ts` + tests
   3. Point the five status consumers at it (`dedupe.ts`, `scraper-save.ts`, `batch-update.ts`, `cli.ts`, `serve.ts`)
   4. `registerAllParsers()` + tests
   5. Point both pipelines at it; fix the mocks in `lib/pipeline.test.ts`
   6. Repoint `.claude/rules/pipeline.md`, `.claude/rules/scrapers.md`, and `.claude/skills/add-parser/SKILL.md`
3. **Verify with `npm run test` and `npm run lint`** — not `tsc`. See the baseline above.
4. **Then plan Task 2**, Extract Single-Job Location Classification, via `/plan-task`.
