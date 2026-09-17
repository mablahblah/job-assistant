# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Session Context** section for reasoning that isn't captured elsewhere. The decisions the user made are not in this document — read [the feature decision log](../docs/features/unified-pipeline/decision-log.md) for those.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

**Phase 11, Work log & enrichment, is built and closed.** So is phase 11a. The next unstarted work is **planning phase 12, the Web UI**.

Before that, **the test flakes must be discussed and resolved**. The user asked for this explicitly, at the start of the next session, before any building. Details are under **The test flakes** below.

Verified at session end: **137 test files, 3,017 tests passed, 17 skipped. `npm run lint` exits 0, including its type check.** The 17 skipped tests are skipped on purpose and describe behaviour a backlog item will restore.

**Nothing is committed.** Two sessions ran against this branch at once, so the working tree holds both phase 11 and a parallel session's phase 11a work. Attribute the diff accordingly: phase 11a touched roughly forty code files — every handler, `lib/orchestrators/scoring.ts`, `lib/utils/run-summary.ts`, `lib/services/trace-service.test.ts` — and deleted `docs/features/unified-pipeline/trace-events.md`.

## Completed This Session

**Task 24 was split into three and all three were built.**

`lib/services/job-service.ts` gained `findByCompanyNameMatch` — part of an employer's name, optionally part of a title, optionally a list of statuses to stay within. It crosses to the `Company` table and returns a narrower shape than every other read, `JobSearchMatch`: id, title, employer name, status, posting date. Its stand-in learned the same, and the inline stub in `lib/handlers/dedupe.test.ts` did too.

`scripts/find-jobs.ts` is new. Flags are `--company`, `--title` and `--statuses`. It prints one line per match, newest posting first, and the fixed phrase `no job matched` where nothing did.

`package.json` gained `find-jobs` and `change-status` scripts.

`.claude/skills/change-status/SKILL.md` was rewritten through the `writing-skills` skill. It now calls the built commands, lists all twelve statuses, looks a job up before changing anything, narrows that lookup by the status being set, and asks for an employer name only where the run reports one missing.

**The phase 11 spec was amended** with 2 user stories, 17 acceptance criteria (86 to 102) and a "Decided while building" section.

**Phase 11 was closed.** The architecture doc now describes the status change, the work log, the employer search and the job lookup as built. Three decision log entries were written. Future Ideas item 34 was retired and the items after it renumbered.

## Session Context

The decisions the user made are in [the feature decision log](../docs/features/unified-pipeline/decision-log.md). **Three entries were written this session**, all dated 2026-09-17, about the job lookup. Do not restate them from here.

### Calls made while building

All four are already written into the phase 11 spec's **Decided while building** section. Read them there rather than here.

### The test flakes

**This is the first thing to do next session, by the user's explicit request, and it is a discussion before it is a fix.**

On one full-suite run, `prisma/schema.test.ts`, `scripts/db-seed.test.ts` and `lib/services/settings-service.test.ts` all failed together and the skipped count jumped from 17 to 38 — the signature of a `beforeAll` hook timing out and taking its whole file with it. All three passed when run alone, and later full runs were clean.

The suspected cause is contention. Each of those files spawns `npx tsx scripts/db-create.ts` as a child process, and the shared 45-second ceiling is reached when several run at once. **Six files now do this.** Phase 11 added three of them: `lib/services/work-log-service.test.ts`, `scripts/change-status.test.ts`, and this session's `scripts/find-jobs.test.ts`.

This matters because the project treats "the suite passes" as its completion gate. A green run that was green by luck and a red run dismissed as noise both cost real information.

### Gotchas discovered

**The job service stand-in matches a different field from the real service.** The real search matches the stored `Company.name`; the stand-in holds no employer table, so it matches `raw_company_name`, the name a collector wrote onto the job. Deliberate, commented in `lib/services/job-service.fake.ts`, and a test needing the stored name belongs against the real service.

**Renumbering the backlog silently breaks cross-references.** Removing Future Ideas item 34 made the phase 11 spec's "Future Ideas item 50" point at the wrong item. Fixed by hand. The user is solving this elsewhere.

**The live `dev.db` no longer matches the code.** `npm run find-jobs` against it refuses to run, naming `Company` and `WorkLogEntry`. This is expected and needs no action — the file goes away at migration and switch over.

### Open questions

**A hard crash between the status write and the work log entry write reports nothing.** Carried from the previous hand-off, still true. A reported failure can be retried; a crash cannot be known about. Named and accepted rather than solved, because no database transaction exists anywhere in this codebase.

**A Workable parser is still unprioritized.** Carried from the previous hand-off and untouched. It cost 32 jobs in the first live run, more than any other platform.

**The broken documentation link count is 65.** It was 58 at the last hand-off. Almost all are the link checker failing to decode `%26` in filenames that really do contain an ampersand. The user expects this to resolve once that cause is fixed. Backlog item "Code Health" is the plausible home.

## Next Steps

1. **Discuss and resolve the test flakes.** The user asked for this at the start of the session, before any other work. See **The test flakes** above for the evidence and the suspected cause. It is a conversation first — the fix is not decided.

2. **Commit.** Nothing from either session is committed, and the two sessions' work is interleaved in the tree. Phase 11 and phase 11a are separate units and deserve separate commits.

3. **Plan phase 12, the Web UI.** Follow the [phase planning procedure](../docs/features/unified-pipeline/phase-planning-procedure.md). Three things already parked for it: the work log page, the weekly grouping and week labels from `legacy/lib/work-search-weeks.ts`, and `.serve.json` pointing at a file that only exists inside `legacy/`.
