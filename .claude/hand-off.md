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

**Phase 8a is closed. Phase 9 is next and not yet planned.**

Verified at session end: **2,229 tests pass across 97 files. `npm run lint` exits 0.** Working tree clean.

**Two commits sit on `feature/unified-pipeline` and have not been pushed.** `50b51da` is the move, `16ac636` is the close. The user was asked whether to push and ended the session instead, so ask again before doing anything else.

## Completed This Session

**Phase 8a, planned, built and closed in one sitting.** The user's framing was "this is simple" and it was.

`lib/` held 56 loose files while collectors, handlers, orchestrators, parsers and tools each had a folder. It now holds ten folders and no file of its own.

| Folder | Source files |
| --- | --- |
| `collectors/` | 13 |
| `db/` | 3 |
| `handlers/` | 7 |
| `orchestrators/` | 1 |
| `parsers/` | 6 |
| `resolvers/` | 2 |
| `services/` | 6 |
| `tools/` | 4 |
| `types/` | 2 |
| `utils/` | 42 |

`lib/collectors/types.ts` and `lib/parsers/types.ts` became `collector.ts` and `parser.ts`.

Four files left `lib/collectors/` because they are not collector code: `fetch-utils.ts`, `job-usable.ts` and `match-categories.ts` to `lib/utils/`, and `fetch-page.ts` to `lib/tools/`.

`.claude/rules/naming.md` was rewritten. It gained a Folders table, a Types section, and Database, Collectors and Resolvers sections. Collectors had no section before. Every other section now names the folder its kind lives in. The rules checklist was run against it and passed every check.

The architecture doc, the decision log, `CLAUDE.md` and the phase spec were all updated. `CLAUDE.md`'s Architecture section had said "Nothing is built yet" since the branch opened.

## Decisions & Context

### What the user decided

Three entries were appended to `docs/features/unified-pipeline/decision-log.md`. Read them there. In short: every file in `lib/` sits in a folder named for its kind and `lib/` holds none of its own; a field mapper read by both a collector and a parser is a util; and "types" is a kind of file with a folder and a rule section of its own.

The user raised two of the three themselves. Their words: _"aren't mappers utils?"_ and _"That seems like a hole, lib/collectors/types and lib/parsers/types... is that redundant?"_ Both were right and both changed the plan.

### Calls made while building

All three are written into `phase-08a-lib-sorting-spec.md`. `trace-proof.test.ts` has no source file of its own and moved to `lib/orchestrators/`, beside the runner it drives. Three fixture data files moved to `lib/utils/` with the tests that read them. `paginate.ts` and `fixture.ts` stayed in `lib/collectors/`.

### The four things that break a move like this, and none is caught by a typecheck

A tidy-up that rewrites `import` lines passes `tsc` and still fails. Four kinds of path hide from it. All four bit this session.

- **`vi.mock("./fetch-page")`** — a mock target is a plain string. Two collector tests kept mocking a path that no longer existed, and 71 tests failed.
- **A path handed to a subprocess.** `lib/services/settings-service.test.ts` builds a few lines of code as a string and runs them with `npx tsx -e`. Its two `require` paths were stale and the test file died whole.
- **A path computed at run time.** Six tests reach the repo root with `resolve(libDir, "..")`. Each file went one level deeper, so each needed one more `".."`.
- **A path in a comment.** Invisible to everything. Several named files that had not existed since phase 7a.

### A dependency that pointed the wrong way

`lib/tools/page-fetcher.ts` was importing a helper out of `lib/collectors/`. A tool depending on collector code is backwards, and it is the same smell phase 3a fixed when a helper imported a step. Sorting by kind is what made it visible. The helper is now `lib/utils/fetch-utils.ts`.

### Left alone on purpose

**`lib/utils/` holds 42 source files.** That is worth watching and it is written into the spec's Out of Scope. A folder that is merely large is not yet a problem, and splitting it would have needed a second set of judgement calls on top of the first.

**Docs for other features still name old `lib/` paths.** `docs/features/reliable-scraping-pipeline/`, `docs/features/security-hardening/` and others reference files that in most cases never existed on this branch. They belong to their own features.

**Meeting notes and the decision log keep their original paths.** Both are dated records of what was true when written. This follows the call made last session about backlog numbers in meeting notes.

## Next Steps

1. **Ask whether to push `50b51da` and `16ac636`.** They are phase 8a and nothing else.
2. **Plan phase 9 — backlog cleanup and classification.** Its r&d file is `docs/features/unified-pipeline/phases/phase-09-classification-r&d.md` and it carries four open questions this phase has to settle: what a cached distance measures from, whether expiry reads the posted date or the updated one, what expiry does with a job carrying no date, and what sets the repost flag and at what date gap. Follow `phase-planning-procedure.md`.
3. **Reword the feature spec's dedupe story when phase 9 is planned.** It says a repost match "sets the repost flag", which the phase 9 r&d records as wrong.
