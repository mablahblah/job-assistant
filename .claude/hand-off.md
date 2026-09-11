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

Feature: **Unified Job Pipeline** — a long-lived branch, `feature/unified-pipeline`. Job searches run from `main`.

**Phase 7, URL Resolution, is nine tasks into eighteen** — halfway. Its spec is at [`phases/phase-07-url-resolution-spec.md`](../docs/features/unified-pipeline/phases/phase-07-url-resolution-spec.md). Six of fourteen phases are closed; phase 7 is the seventh and is mid-build.

The whole walk now exists offline and the first database-facing task is done. What remains is the plumbing: the job list, the step, the orchestrator, and the retrofits.

**1,817 tests across 73 files pass, `npm run lint` exits 0**, both verified fresh at close.

**Four commits, pushed** — `064166d..d0de370`. The working tree is clean.

| Commit | What it carries |
| --- | --- |
| `0ff6d2b` | Task 9 — `delete_on_save` takes `DeleteOnSaveReason`, and its test |
| `a4a3bb1` | Two decisions — settling polls, the four-hop budget stands |
| `f5ad8db` | The task 9 tick and the previous session's hand-off |
| `d0de370` | The `CLAUDE.md` quarantine line, deleted as redundant |

**One untracked file:** `.claude/CLAUDE.md.bak`, a pre-edit copy of `CLAUDE.md` differing only by the line `d0de370` removed. Deliberately left out of every commit — it is redundant with git history. See open question 3.

## Completed This Session

A short session: one task, and the closing of the oldest open question on the phase.

- **Task 9 widened `delete_on_save`**, `lib/job-list-entry.ts`. The field takes `DeleteOnSaveReason` — dedupe's three reasons plus `blacklisted_url` — so resolution can mark a job whose walk reached a blacklisted host for deletion. `DedupeReason` is untouched, which is the point: the *field* admits four words, but dedupe's own code is still held to three and cannot write the new one. `DELETE_ON_SAVE_REASONS` derives from `DEDUPE_REASONS` by spread rather than restating those three. Criterion 60 covered.
- **Open question 1 is closed by a user decision** and is in the decision log, dated 2026-09-11. It had been running in `lib/resolve-job-url.ts` on inference since the previous session.

## Decisions & Context

### The one decision the user made

**The four-hop ceiling stands as planned.** A walk reaching the ceiling with a link unfollowed judges that link by its own href — same-host resolves where the walk stands, off-host fails — and both outcomes trace as `hop_budget_spent`, so a real run measures how often four hops binds before anything is made smarter. No code changed; the decision ratified what was already built. The user's framing was to keep it simple, see how it performs, and extend later if the numbers ask for it.

### Calls made while building, none of them user decisions

- **The writer selection went to the inline literal.** Both writers produced the same type and list; one extracted a `BLACKLISTED_URL_REASON` constant and derived the type with `typeof`, mirroring the file's existing `REASON_ON_A_JOINING_ROW`. Rejected, because that existing constant earns its name — `REASON_ON_A_JOINING_ROW` says something `"matched_list_entry"` does not — whereas `BLACKLISTED_URL_REASON` is the literal in capitals. The losing writer's comment explaining why the list derives from `DEDUPE_REASONS` was better, and was taken.
- **Placement was changed on application.** Both writers put the new type and list *after* `JobListEntry`, because that is where the pasted context ended. The file defines types before use, so they went above it.
- **One test for AC 60, not several**, because the criterion is one behaviour — what the field admits. The type-assignment loop inside that test looks redundant at runtime and is not: vitest does not typecheck, so assigning each reason to a `JobListEntry` is what puts the widened type in front of `tsc`, which only `npm run lint` runs.
- **Four commits split by goal** — code, decisions, progress docs, and the `CLAUDE.md` tidy — following the branch's existing habit.

These are work-documentation under the decision-log rule and belong in the feature spec. **They have not been written anywhere** — see open question 1 below.

### Gotchas found this session

- **The commit hook's file counts are wrong for a third session running.** It reported 6 changed files on a 2-file commit and 4 on a 2-file commit. It reported zero test gaps this time, which at least matches reality. Do not act on its numbers without checking.
- **`npm run lint` is the only gate that catches a type error**, and this session that mattered directly rather than incidentally: criterion 60 is a criterion *about a type*, so the suite passing proves almost nothing about it on its own.

### Approaches tried and abandoned

- **Extracting `BLACKLISTED_URL_REASON` as a named constant**, for the reason given above. Correct code, matching a shape already in the file, but the name repeats the literal rather than explaining it.

### Open questions

1. **Whether sixteen work-documentation items go in the feature spec.** Ten carried from previous sessions: `decideNextAction`'s signature, `PageAnchor` instead of adding `"dom"` to the tsconfig `lib` array, the fake resolving hrefs by rewriting attributes, the five file names, `APPLY_LINK_PATTERNS` staying module-private, committing by goal, task 8 being two files, five tests for the settle condition, a URL change during settling counting as progress, and `ResolutionOutcome` being three-way. Six added this session, listed above. This has now been carried three sessions and grows every time.
2. **Whether to correct the phase 7 r&d's open-question entry** with the uiuxjobsboard measurement from two sessions ago.
3. **What happens to `.claude/CLAUDE.md.bak`** — delete it, add `*.bak` to `.gitignore`, or leave it untracked. Asked twice this session and not answered; left untracked, which is the choice that destroys nothing.
4. **Whether the commit hook's misattribution gets filed as a backlog item.** Raised at close, not answered.

The previous hand-off's open question 1, on the hop-budget split, is **closed** — see the decision above.

### Carried forward, still true

`cat` is blocked over 2048 bytes — use `sed -n` or Read. `grep -r --include` needs the pattern quoted. `timeout` is not on PATH. `npm run lint` runs ESLint then `tsc --noEmit`, and vitest does not typecheck, so lint is the only gate that catches a type error. `$?` after a pipe is the last command's, not npm's — redirect to a file and check `$?` directly. tsconfig has `strict: true` but not `noUncheckedIndexedAccess`, so array indexing types as non-undefined. ESLint carries no `curly` rule and no formatter. `dev.db` at the repo root is the legacy database; `pipeline.db` is the new one. `/change-status` does not work on this branch — it calls `npx tsx scripts/cli.ts`, and the CLI is at `legacy/scripts/cli.ts` here. Anything new under `lib/steps/` loads `pipeline-steps.md` and `naming.md`. Rule edits go through `writing-rules`, skill edits through `writing-skills`. A `docs/BACKLOG.md` change needs approval first. Questions are plain text. Every message over one paragraph ends with a TL;DR.

**Production code is written through `crowd-code`, never edited directly.** Writing the failing test first is the session's own job under crowd-code Phase 2; everything the writers produce is theirs.

Backlog entry 26, **Resolver Refinements**, holds six deferred improvements to this walk, each waiting on a measured failure from a real run. Nothing this session produced one.

## Next Steps

1. **Task 10, the resolution job-list read** on the job service and its fake: every job whose status is `backlog` and whose `is_resolved` is false, whenever it was collected, carrying `id`, `collector` and `created_at` and leaving the four flags behind. Criteria 1 to 4. Two files, so two `crowd-code` changes.
2. **Task 11, the concurrency setting** in the schema and the seed.
3. **Task 12, the resolution step** over the job list, with its browser contexts and concurrency — the first task to need the page factory the spec's Approach section describes.
4. **Then tasks 13 to 18** — `runResolution`, the dedupe set-aside, the `leavingRow` retrofit, the save warning, Dribbble self-resolving, and the trace vocabulary.
5. **Answer open questions 1 and 3** — the first has been carried three sessions and is the one most likely to be lost.
6. **`architecture.md:110` and the phase 5 and 6 specs still encode the old `abandoned` meaning.** That stays correct until task 15 lands, which supersedes those specs' criteria; phase 7's close updates the architecture doc.
