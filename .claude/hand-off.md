# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Session Context** section for reasoning that isn't captured elsewhere. The decisions the user made are not in this document — read the feature decision log for those.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

**Phase 13 is built and closed. The Unified Job Pipeline has one box left: Ship.** Every phase from 0 through 13 is checked in `docs/CURRENT-FEATURE.md`.

The switch over happened. Real job searches now run on this branch against `pipeline.db`. `legacy/` is deleted, and `dev.db` is kept only as an archive.

Suite at session end: 158 files, 3,287 passed, 17 skipped. Lint and the type check pass.

**Uncommitted, and not from this session.** `docs/BACKLOG.md` and `docs/features/collector-parser-expansion/feature_r&d.md` are modified, and `docs/features/unjudged-jobs-in-backlog/` is untracked. These came from another session. The user was asked and said they are fine, so they were left alone.

Also untracked at the repo root: `pipeline.db.2026-09-18T04-04-11.backup`, written automatically by `db:migrate` before the baseline was adopted.

## Completed This Session

Four commits, then the phase close.

1. **The resume skill re-homed.** `scripts/fetch-rendered-page.ts` is a new command wrapping the rendered-page fetcher. The skill looks jobs up with `npm run find-jobs -- --company X --json`, fetches `resolved_url` when present and `original_url` otherwise, reports a failed fetch as a tool failure, and closes the dead-posting branch with a message and no status write.
2. **The run identifier prints and travels.** `npm run job-search` prints `Run: {id}` first. Both skills carry it. `score:gather` warns when handed an identifier matching no trace rows, and never warns on one it minted.
3. **The old folder deleted.** `legacy/` and the `cli` npm entry are gone. The add-external-jobs skill carries a note naming the switch over as its break.
4. **The switch over ran, checked by eye.** 54 employers, 59 active jobs, 70 work log entries crossed. The migration verified every count against the old database itself.

Then the first real job search on the new pipeline, and the phase close: architecture doc, `CLAUDE.md`, and `CURRENT-FEATURE.md` corrected.

## Session Context

- **The decisions the user made are in the feature decision log.** One entry was drafted this session and the user rejected it. Do not re-propose it.
- **The runbook's "rebuild once" step could not run.** `db:create` refuses the file `PIPELINE_DATABASE_URL` names, which is exactly what task 1 built. The target was already empty, so the switch over ran `db:migrate` to adopt the `0_init` baseline, then seed, then migrate. `db:migrate` wrote a dated backup first.
- **The fetch command was an extra file beyond the spec's 15 tasks.** The spec assumed the skill would reach the fetcher somehow but never said how.
- **Skill-file criteria are proven by reading the file**, per the spec. Two new test files do it: `scripts/generate-resume-skill.test.ts` and `scripts/run-identifier-skills.test.ts`.
- **Deleting `legacy/` needed two steps.** `git rm -r` left untracked leftovers behind, including two zero-byte `dev.db` files. Both were confirmed empty before `rm -rf`. The live `dev.db` at the repo root, 2.1 MB, was never touched.
- **Eleven work log entries name jobs that did not migrate.** Those jobs were rejected, so they stayed behind. All eleven carry their own employer name and job title, so the Texas filing still fills. This is the design, not a fault.
- **Figma's migrated address reads "test".** This is the known placeholder the spec predicted.
- **Two false alarms on the resume PDF, both from this session's own checking.** Listing the resumes folder with `tail -5` hid the new file, which sorts earlier alphabetically. A crude text extraction reported the PDF empty because it embeds partial fonts. Read the PDF properly instead.
- **`cd` into the portfolio project resets the shell working directory afterwards.** Use absolute paths.

## What the First Live Run Exposed

Run `644ac69f-e797-4a27-94e3-e41a76fe49fc`, 2026-09-18. It finished cleanly and exited zero.

- **238 collected, 138 resolved, 60 parsed.** 53 duplicates dropped.
- **82 jobs could not be parsed** because no reader exists for their site: Workday 18, Workable 17, Adzuna 9, Experteer 6, SmartRecruiters 5. These leave the backlog as `unparseable` and never reach scoring.
- **23 backlog jobs stayed unresolved.** 22 pages refused the browser and 1 would not load. Both reasons are treated as retryable, so those jobs keep their backlog status for the next run. Mostly JSearch and Adzuna links.
- **18 jobs scored, 32 employers researched.** Eleven employers fully, 21 partly guessed where nothing public existed.
- **Four employers earned direct polling**, which cleared the cold-start warnings on its own.

No new backlog item came out of this. The parser gap is **Remaining ATS Parsers** and **Collector & Parser Expansion**; the refused pages are **Unjudged Jobs Show in the Backlog** and **Resolver Refinements**.

## Next Steps

1. **Ship the feature.** Run `/ship-feature`. It is the only unchecked box in `docs/CURRENT-FEATURE.md`.
2. **Expect a backlog cleanup during ship.** The feature spec requires every item the shipped pipeline made redundant to be proposed for removal, with the user approving the list before anything is deleted.
3. **Decide what happens to the other session's uncommitted doc changes** before shipping, so the branch is clean when it merges.
4. **Leave `dev.db` alone.** Backlog item 34 covers deleting it once the migration has proved itself over time.
