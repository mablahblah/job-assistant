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

**Phase 7a is planned, and 1 of its 10 tasks is built.** It reshapes the pipeline into one orchestrator calling one handler per leg, and ends with the pipeline running for real against live job sites. Its spec is [`phases/phase-07a-orchestrator-handlers-spec.md`](../docs/features/unified-pipeline/phases/phase-07a-orchestrator-handlers-spec.md) — 21 acceptance criteria, 10 tasks.

Task 2 is next: the handler contract, `naming.md`, and the `CLAUDE.md` glossary line.

1,886 tests pass across 76 files. `npm run lint` exits 0.

Two commits are pushed and the remote matches: `9193a17` (the planning) and `f171eb9` (task 1). `docs/CURRENT-FEATURE.md` is modified and uncommitted — it holds task 1's checkbox. Two files in `.claude/` have never been committed: `CLAUDE.md.bak` and `session-status.md`.

## Completed This Session

**Phase 7a was planned.** The conversation that created phase 7a had happened inside a phase 7 build session, so it produced decisions and meeting notes but never a spec. This session wrote that spec, closed the three questions it left open, and recorded six new decisions.

**Task 1 was built.** `lib/handlers/` now holds the five handlers and their tests. `lib/orchestrators/` holds `search-orchestrator.ts` and `resolution-orchestrator.ts`, which tasks 4 and 5 dissolve. `lib/steps/` is gone. The handler contract's `paths:` was repointed. Test count unchanged at 1,886, which is what a pure move should give.

**A context-usage hook was added, outside this project.** `~/.claude/hooks/context-usage.py`, wired into `~/.claude/settings.json`. It reads the session transcript's newest token-usage record and reports how full the context window is. It reports every turn on `UserPromptSubmit`, and during tool use it stays silent below 50% then speaks once per 10% band. Proven firing by sentinel test.

## Decisions & Context

### What the user decided

Six decisions, all dated 2026-09-11 in the feature decision log:

- The pipeline runs from `npm run job-search`.
- The `job-search` skill starts the orchestrator and reports what came back, naming no handler and no leg.
- `runCollection` and `runResolution` are dissolved into the orchestrator rather than becoming handlers. Only the collectors loop becomes one.
- A handler is handed the step name its trace rows record. What stops being called a step is the handler itself.
- A piece wrapping something outside the app is a **tool**, and `lib/tools/` holds it.
- Phase 7a wires resolution in and builds the real Playwright browser, so the pipeline reaches the post-resolution save against live sites.

### Calls made while building, and why

- **The two orchestrator files went to `lib/orchestrators/` in task 1**, where the spec had said they stay put. Leaving them would have kept `lib/steps/` alive holding only files that are not steps. The spec was updated to match. This was flagged after the fact and not objected to.
- **`normalization-step.test.ts` was renamed `normalization-handler.test.ts`**, since the word it tests changed.
- **The failure report's shape was proposed, not signed off.** Finished handlers with their counts, then the handler that threw and the reason. It sits in the spec as criteria 8 and 9 and task 6. The user's ruling was the behaviour — stop and warn loudly — which was already decision 317.

### Gotchas

- **"cont" meant continue the conversation, not start building.** Task 1 was started on a misread. Check before moving from planning into code.
- **The commit hook's numbers are wrong, a sixth session running.** It reported 30 changed files on a 5-file commit. Do not act on what it says.
- **`npm run lint` is the only check that catches a type error.** The test runner does not check types.
- **The session transcript records the model as `claude-opus-5` with no `[1m]` marker and carries no window size.** The context hook therefore defaults to 1,000,000. On a 200k model, set `CLAUDE_CONTEXT_WINDOW` in the global settings `env` block.
- **`git status --cached` is not a flag.** Use `git diff --cached --name-only`.
- **The Bash tool's working directory persists between calls.** A `cd` in one call changes where the next one starts, so a later relative path can miss. Use absolute paths.

### Approaches abandoned

- **Removing the `step` argument from every handler.** Proposed on a misreading of "the handlers should not specify step". The argument is correct and stays; what was wrong was calling the handler itself a step.
- **Treating `--limit 0` as a problem.** It was argued that the flag would let the test suite reach a real browser once resolution joined the run. Reading `scripts/collect.test.ts` dissolved it: the suite spawns the command against a fresh scratch database holding no jobs, so the resolution leg finds nothing and launches nothing.

### Open questions

1. **What happens to the two uncommitted files in `.claude/`?** Asked across six sessions. Raised again this session and not answered. Left untracked, which destroys nothing.

## Next Steps

1. **Commit `docs/CURRENT-FEATURE.md`**, which carries task 1's checkbox.
2. **Build task 2 — the vocabulary.** `pipeline-steps.md` becomes the handler contract, renamed and reworded. `naming.md` gains Orchestrators and Tools sections and its Steps section becomes Handlers. The `CLAUDE.md` glossary line "Collector: Tool that pulls raw job list" loses "Tool that". Rule edits go through `writing-rules`.
3. **Build tasks 3 through 10**, in order. Tasks 4, 5 and 6 all rewrite the same orchestrator, so they are an awkward place to break across sessions.
4. **Close phase 7a** — architecture document, decision log, any backlog change presented for approval.
5. **Plan phase 8 — Parsers.**
