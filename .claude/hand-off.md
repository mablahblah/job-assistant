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

The job pipeline is being rebuilt on the branch `feature/unified-pipeline`. Real job searches still run from `main`.

**Phase 7 is built and closed.** All 18 of its tasks are done. It built URL resolution: following a job's link from a listing site through to the employer's own posting. Its record is [`phases/phase-07-url-resolution-spec.md`](../docs/features/unified-pipeline/phases/phase-07-url-resolution-spec.md).

Nothing is in progress. The next unit of work is planning phase 7a, which has no plan document yet.

1,886 tests pass across 76 files. `npm run lint` exits 0. Both were checked at close.

The branch is pushed. The remote matches it at `ccaa7ff`. The working tree is clean. Two files in `.claude/` have never been committed: `CLAUDE.md.bak` and `session-status.md`.

## Completed This Session

Three tasks, then the phase close.

- **Task 16.** The warning raised when a delete is refused now reads two ways. A job whose walk reaches a blocked site is marked for removal the same way a duplicate is, and the same guard refuses both. The row that refuses a blocked job is its own, so the single wording called the job a duplicate of itself.
- **Task 17.** Dribbble marks its own jobs resolved as it collects them. It hosts the posting its card points at, so there is nowhere to walk to. Three of its listings share one "View job" link, and walking them would give three different jobs one address, which duplicate removal reads as proof they are one job.
- **Task 18.** Resolution's two events and eight reasons are written into the `Trace` comment in `prisma/schema.prisma` and into `trace-events.md`, with a test holding the two together. Both had also been left saying `abandoned` means no database row existed, which stopped being true when task 15 landed.
- **The close.** The architecture document gained the resolution leg and its eleven parts.

Every call made while building is in the phase 7 record, under **Build Notes**. This document does not carry them.

## Decisions & Context

### What the user decided

Nothing this session. Every decision phase 7 rests on was made while planning it and is in the decision log, dated 2026-09-11.

### Calls made while closing, and why

- **The architecture document now names a fourth kind of part: an orchestrator, which runs one leg of the pipeline.** The collection one was relabelled from step to orchestrator at the same time. Neither of the two takes a job list and hands it back, which is what the step contract says a step does, so the document was teaching a shape the code does not have. This reaches into vocabulary phase 7a is meant to settle. It is one edit to undo.
- **The blocked-site refusal reuses the existing warning kind** and branches on why the job was marked, rather than taking a kind of its own. One guard refusing one delete should not make the save step pick between two words.
- **No backlog change came out of phase 7.** The six deferred improvements to the walk are already entry 26, still waiting on a real run. Nothing else in the list became redundant.

### Gotchas

- **The commit hook's numbers are wrong, a fifth session running.** It reported 12 changed files on a 3-file commit. It named a function untested that three tests cover. Do not act on what it says.
- **`npm run lint` is the only check that catches a type error.** The test runner does not check types.

### Open questions

1. **Does the architecture document get to name "orchestrator" before phase 7a decides the vocabulary?** Raised at the close of this session and not answered. The naming stands in the document today.
2. **Does wiring resolution into the pipeline belong to phase 7a?** Starting the real browser goes with it. Nothing starts a real browser today — the code is handed one, and every test hands it a fake. Proposed two sessions ago, never answered.
3. **What does the orchestrator report when one of its parts falls over?** It needs a shape carrying both the finished work and the failure.
4. **Do the `Trace.step` values get renamed?** They hold positions in the pipeline, such as `post_collection_dedupe`, rather than the name of a piece of code. Phase 11a owns cleaning up trace words.
5. **What happens to the two uncommitted files in `.claude/`?** Asked across five sessions. Never answered. Left untracked, which destroys nothing.

### Still true

- `cat` is blocked over 2048 bytes. Use `sed -n`.
- `timeout` is not on PATH.
- `$?` after a pipe belongs to the last command, not to npm. Redirect to a file instead.
- Array indexing types as non-undefined. `noUncheckedIndexedAccess` is off.
- `/change-status` does not work on this branch.
- Rule edits go through `writing-rules`. Skill edits go through `writing-skills`.
- A `docs/BACKLOG.md` change needs approval before it is written.
- Questions are asked as plain text in conversation.
- **Production code is written through `crowd-code`, never edited directly.** That skill sends two sub-agents the same failing test and picks the stronger answer. Writing that failing test first is this session's own job. Markdown, documentation and `prisma/schema.prisma` are edited directly.

## Next Steps

1. **Plan phase 7a**, following the [phase planning procedure](../docs/features/unified-pipeline/phase-planning-procedure.md). It reshapes the pipeline into one orchestrator calling one handler per phase. Its five decisions are in the decision log, dated 2026-09-11, and the reasoning is in [`meeting-notes/2026-09-11-phase-07a-pipeline-shape-meeting-notes.md`](../docs/features/unified-pipeline/meeting-notes/2026-09-11-phase-07a-pipeline-shape-meeting-notes.md). Open questions 1, 2 and 3 above all land inside it.
2. **Build phase 7a.**
3. **Close phase 7a** — architecture document, decision log, any backlog change presented for approval.
4. **Plan phase 8 — Parsers.**
