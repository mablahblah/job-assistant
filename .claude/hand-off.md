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

Phase 7 is 15 tasks of 18. It builds URL resolution: following a job's link from a listing site through to the employer's own posting. Its plan is at [`phases/phase-07-url-resolution-spec.md`](../docs/features/unified-pipeline/phases/phase-07-url-resolution-spec.md).

A phase 7a was planned this session. It has no plan document yet.

1,871 tests pass across 76 files. `npm run lint` exits 0. Both were checked at close.

**15 commits are unpushed**, starting from `e0aaaf9`. The working tree is otherwise clean. Two files in `.claude/` have never been committed: `CLAUDE.md.bak` and `session-status.md`.

## Completed This Session

Six tasks, then a design conversation.

- **Task 10.** The job service can list every job still waiting to be followed. Four fields are left off each one. They record which stage a job has reached, and a stale copy would overwrite what a later stage owns.
- **Task 11.** How many jobs are followed at once is now a setting, `resolution_concurrency`. It is seeded at 3.
- **Task 12.** The code that follows the whole list. It runs several jobs at once. Each gets its own browser page, closed however it ends.
- **Task 13.** `runResolution`. It reads its own list, follows every job, removes duplicates, and saves.
- **Task 14.** Duplicate removal now skips any job already marked for deletion.
- **Task 15.** A job dropped during duplicate removal now always records `abandoned`. It used to claim a database row was deleted. Only the save step decides that, and it can refuse.

Every call made while building is written into the phase 7 plan, under **Build Notes**. This document no longer carries them.

## Decisions & Context

### What the user decided

Five decisions. All are in the decision log, dated 2026-09-11.

- One orchestrator runs a whole pipeline. Nothing sits between it and the code it calls.
- The files in `lib/steps/` are renamed **handlers**. A handler takes the job list, acts on every entry, and hands the list back.
- Collection becomes a handler. Parsing will too. Collection is the one that takes no list, because it builds the first one.
- A handler falling over stops the run and warns loudly. Nothing finished is lost, because every stage ends by writing to the database.
- That reshaping happens in phase 7a, after phase 7.

The reasoning is in [`meeting-notes/2026-09-11-phase-07a-pipeline-shape-meeting-notes.md`](../docs/features/unified-pipeline/meeting-notes/2026-09-11-phase-07a-pipeline-shape-meeting-notes.md).

### What went wrong

`runResolution` was first put in a file named `resolution-orchestrator.ts`. That gave the project two files calling themselves orchestrators. Neither ran a pipeline. The user caught it. The fix became phase 7a.

### Gotchas

- **The commit hook's numbers are wrong, a fourth session running.** It reported 8 changed files on a 7-file commit. It named tested functions as untested. Do not act on what it says.
- **`npm run lint` is the only check that catches a type error.** The test runner does not check types.

### Open questions

1. **Does wiring resolution into the pipeline belong to phase 7a?** Building the real browser goes with it. This was proposed and not answered. Nothing starts a real browser today. The code takes one as an argument and every test supplies a fake.
2. **Do the `Trace.step` values get renamed?** They hold positions in the pipeline, such as `post_collection_dedupe`, rather than the name of a piece of code. Task 18 writes more of them, so a rename would partly redo it.
3. **What does the orchestrator report when a handler falls over?** It needs a shape that carries both finished work and a failure.
4. **What happens to the two uncommitted files in `.claude/`?** Asked across four sessions. Never answered. Left untracked, which destroys nothing.

### Still true

- **The output style is new. Write to it, in conversation and in every document.** One idea per sentence. No sentence over 20 words. Plain words, and any term that only means something inside this project gets its plain meaning where it first appears. Earlier hand-offs leaned hard on that project vocabulary and ran long; this one was cut from 1,450 words to 980 to stop it.
- `cat` is blocked over 2048 bytes. Use `sed -n`.
- `timeout` is not on PATH.
- `$?` after a pipe belongs to the last command, not to npm. Redirect to a file instead.
- Array indexing types as non-undefined. `noUncheckedIndexedAccess` is off.
- `/change-status` does not work on this branch.
- Rule edits go through `writing-rules`. Skill edits go through `writing-skills`.
- A `docs/BACKLOG.md` change needs approval before it is written.
- Questions are asked as plain text in conversation.
- **Production code is written through `crowd-code`, never edited directly.** That skill sends two sub-agents the same failing test and picks the stronger answer. Writing that failing test first is this session's own job.
- Backlog entry 26 holds six improvements to how links are followed. Each waits on a real run to show it is needed. Nothing this session produced one.

## Next Steps

1. **Push the 15 commits.**
2. **Task 16.** Wording for the warning raised when a job cannot be deleted because the user has already applied to it. It needs its own phrasing rather than the one used for duplicates. The file is `lib/save-warnings.ts`. Criteria 64 and 65.
3. **Task 17.** Dribbble marks its own jobs as already resolved. Three of its listings share one link, so following them would give three different jobs the same address. Criteria 57 to 59.
4. **Task 18.** Write resolution's events into three places: the `Trace` comment in `prisma/schema.prisma`, the file `trace-events.md`, and `prisma/schema.test.ts`. Criteria 66 and 67.
5. **Close phase 7.** The architecture document still describes the old meaning of `abandoned` at line 110.
6. **Plan phase 7a, then build it.**
