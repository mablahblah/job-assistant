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

Feature: **Unified Job Pipeline** — thirteen phases on the long-lived branch `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 1 (Collection) is complete and closed.** **Phase 2 (Tracing) is planned and not built.** No code was written this session — every change is documentation.

**The working tree is clean and pushed through `83284a1`.**

The spec is `docs/features/unified-pipeline/phases/phase-02-tracing-spec.md`, read with `phase-02-tracing-r&d.md` beside it. It carries 33 stories, 56 acceptance criteria and 8 tasks. Unlike the Phase 1 spec, its stories and criteria are separate lists that do not map one to one — a reference like "AC 33" always means the criteria.

Every phase now has three boxes in `CURRENT-FEATURE.md` — Plan, Build, Close — where it used to have two.

## Completed This Session

**Phase 2 planned end to end.** Brain dump, orientation, conflict discussion, four stress-test agents, 56 criteria, the spec, `spec-review`, and `wrap-up-planning`. Committed as `83284a1`.

**Phase 1 closed.** The architecture doc still described a phase that had not started — `Services` and `Data Model` both read "_None yet._", the ported-from-legacy table was a placeholder row, and the run diagram omitted the post-parsing dedupe the feature spec requires. Both long-standing r&d smells cleared. The Ashby backlog item removed, flagged in three consecutive hand-offs. Committed as `d6198c6`.

**Verified:** `npm run test` 852 passing across 31 files, `npx tsc --noEmit` exit 0, `npm run lint` exit 0.

## Decisions & Context

The 25 signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — it is the authority. One 2026-08-26 entry was **superseded**: it said some traces describe results that never became jobs, which stopped being true when `job_id` became required.

The full conversation is in `docs/features/unified-pipeline/meeting-notes/2026-08-30-phase-02-tracing-meeting-notes.md`.

**The shape of the thing, in one paragraph.** Tracing is a journey funnel and nothing else. A job enters at collection, passes through each step, and either reaches the end or hits a dead end recording when and why. Source health — a board answering empty, a timeout, a platform with no slugs — is about a source rather than a job and is deliberately excluded. Only the job search writes traces.

**Three obligations Phase 1 handed forward, all resolved:** the collector retrofit shrank to nothing, because both events live in the orchestrator; tracing the search-term drop was withdrawn; surfacing a source that answered but sent nothing was dropped outright, not deferred.

**Two things the user rejected in favour of something better.** A `collection_run_id` column to fix cross-run cohorts — replaced by requiring a collected event and a terminus event in the same run, which needs no schema. And nullable `run_id` for non-pipeline callers — replaced by narrowing to job-search-only writes.

**Measured or verified this session:**

- `crypto.randomUUID()` is a bare global under this tsconfig, no import. Confirmed with `tsc --noEmit`.
- `Int @id @default(autoincrement())` already works in this repo — `prisma/schema.test.ts:276`. No spike needed.
- A `Json` column read through raw SQL comes back as text holding JSON, not an object — `prisma/schema.test.ts:88-90`.
- `--limit 0` returns at `search-orchestrator.ts:58` before the collector loop, so `scripts/collect.test.ts` can never reach the code the events live in.
- 33 `runCollection` call sites: 32 in `search-orchestrator.test.ts`, one in `scripts/collect.ts`.
- `unusableReason` has six branches; one interpolates the offending URL. About 25 assertions match its message by substring, so its wording is unguarded.

**Constraints and gotchas:**

- **`/commit-and-push` and `/hand-off` cannot be invoked by the Skill tool.** The user must type them; the tool refuses and forbids replicating them.
- **Renumbering `BACKLOG.md` breaks bare-number references elsewhere.** Removing the Ashby item shifted 21 entries and broke two live references to "item 23". Both now name the item as well as numbering it.
- **A subagent given a spike-shaped question may go and run it.** One created files under `generated/` mid-task; it was stopped, made to delete them, and the repo verified clean before its findings were used.
- **`spec-review` forbids writing the draft before approval; the phase planning procedure writes the spec at step 6 and reviews at step 7.** The procedures conflict.
- **`build-requirements` Phase 2 re-asks discovery questions** a phase planning conversation has already settled.
- **A trace write must never throw.** The per-job loop sits inside the orchestrator's `try` around the collector call at `search-orchestrator.ts:67`, where a throw is read as a collector failure and costs every remaining job from that source.

**Open questions:**

- **The four silent source assumptions** in the Phase 1 r&d, still unguarded. They produce well-formed jobs with quietly wrong data, which the usability check does not catch.
- The Phase 3 and Phase 4 questions in their r&d files: whether Association's two passes differ, whether JSearch's employer name can be trusted for a match, whether a slug match should correct a stale seeded name, and what normalizing a title does.

## Next Steps

1. **Run `/audit`.** Carried over from the last hand-off and still not run. Do this before any Phase 2 build work.
2. **Build Phase 2, task 1 — the Trace table.** Add the model to `prisma/schema.prisma` with the step and reason vocabularies in its comment, run `npx prisma generate` (`db:create` alone does not regenerate the client), and make the five additions to `schema.test.ts` listed in the spec's task 1. Criteria 1–10.
3. **Then tasks 2 through 8 in order.** The table before the writer, the writer before the events, so nothing is built against something absent.
4. **Close Phase 2** when the build is done — the architecture doc gains the `Trace` model and the trace writer, which is what AC 52 means now that Phase 1's staleness is fixed.
