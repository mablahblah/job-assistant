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

**Feature:** Export Parsable PDF Resume (`minor` `M`) — see `docs/features/export-parsable-pdf-resume/feature_spec.md`.

**In progress:** Reconnecting the `/generate-resume` pipeline after the portfolio project was rebuilt from a static HTML site into a React SPA (renamed `home-site` → `mablahblah_com`). The `generate-pdf.js` CLI contract survived the rebuild unchanged — **the skill needs no logic changes; only the environment moved.** Verified end-to-end via smoke test.

**Validation gate:** The user is running a real job search and applying to jobs with `/generate-resume` — this is the first true end-to-end exercise of the skill (find-job → fetch-page → selection → PDF) and of the PDF's visual layout. **If that goes smoothly, it's the green light to ship Task 3 and then the feature.**

**Modified files (grouped):**
- *This feature — commit together:* `.claude/skills/generate-resume/SKILL.md` (portfolio path `home-site` → `mablahblah_com`, ×3), `docs/features/export-parsable-pdf-resume/integration-contract.md` (Node 22, `npm install` prereq, auto-build note, `src/data/resume.json` ×3), plus June-24 closeout edits to `feature_spec.md` / `decision-log.md` / `CURRENT-FEATURE.md` / `BACKLOG.md`, the untracked `task_generate-resume-skill/` docs, and the `docs/ideas/fetch-page-paste-fallback/` idea.
- *Unrelated — do NOT sweep into feature commits:* `docs/research/*`, `prisma/schema.prisma` + `prisma/migrations/20260628000000_work_search_entry_restrict_delete/`, `scripts/backfill-work-log.ts`, `.claude/skills/serve/SKILL.md`, `docs/search-issues.md`.

## Completed This Session

- Smoke-tested `generate-pdf.js` against the rebuilt React portfolio: `--inventory` returns valid JSON; `--selections`/`--output` produced a real 32 KB `%PDF-`. Contract confirmed intact.
- Refreshed `integration-contract.md`: Node v18+ → v22, added `npm install` prerequisite, added the one-command auto-build/serve behavior, and `data/resume.json` → `src/data/resume.json` (3 spots).
- Added two `2026-07-17` entries to the feature decision log (React target + contract-unchanged; Task 3 framing).

## Decisions & Context

- **Portfolio is now a React SPA at `~/Documents/Projects/code/mablahblah_com`.** The `generate-pdf.js` contract is unchanged (flags, selections format, `ERROR:` semantics). New env requirements: Node 22, `npm install` in the portfolio, the script auto-builds/serves itself, inventory at `src/data/resume.json`. You never start a dev/preview server.
- **Task 2 was built and worked pre-rebuild, then the migration broke its environment.** Rather than ship a broken Task 2, the reconnection is tracked as **Task 3 (Reconnect Resume Generation to React Portfolio)** — env/doc only, no code. Task 3's ship is the real deliverable; Task 2 is not shipped independently.
- **Workflow mechanics:** a task "Ship" is a marker commit *on the feature branch* (e.g. `f90c8b2 Ship: Job Lookup CLI Commands`), NOT a merge to main. Only the **feature** ship merges to main via PR (`Close feature:` convention). Nothing broken can reach main before the feature ship.
- **Open question:** whether to check Task 2 off as *built-but-superseded* (recommended — honestly records build → external change → adapt) or leave it unchecked. User's call, still unresolved.
- **`feature_spec.md` Architectural Blueprint is stale** — still says portfolio path `home-site` and `data/resume.json`. Needs updating as part of the Task 3 ship (not yet done).

## Next Steps

_Do these only if the job applications went smoothly (skill works end-to-end)._

1. **Add Task 3 to `feature_spec.md`:** "Reconnect Resume Generation to React Portfolio — env/doc only; update SKILL.md path, integration-contract.md, and the Architectural Blueprint." Check off Task 2 per the open-question decision.
2. **Update the `feature_spec.md` Architectural Blueprint:** portfolio path → `mablahblah_com`, `data/resume.json` → `src/data/resume.json`, note Node 22 + auto-build.
3. **Check off the feature's Acceptance Criteria** now satisfied by the successful end-to-end run.
4. **Stage ONLY this feature's files** (see grouping above) — keep the unrelated changes out. Commit the Task 3 work.
5. **Ship Task 3** — marker commit on the feature branch (`Ship: Reconnect Resume Generation to React Portfolio`).
6. **Ship the feature** — run the `merge` skill to audit/QA/test, open the PR, merge to main, and verify a clean tree. Handle the unrelated uncommitted changes separately (their own commits) so the tree is clean before the merge.
