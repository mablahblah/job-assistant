# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Session Context** section for reasoning that isn't captured elsewhere. The decisions the user made are not in this document — read the feature decision log for those. If a planning conversation was under way, read the meeting notes named in **Current Task** for how it got there.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

- **Feature** - ATS and HR System Parser Expansion, on branch `feature/ats-parser-expansion`. All eleven tasks in `docs/CURRENT-FEATURE.md` are checked. The feature is ready for `/ship-feature`.
- **Docs** - `docs/features/ats-parser-expansion/`: `feature_spec.md`, `decision-log.md`, `meeting-notes.md`, `feature_discovery.md`.
- **Nothing is committed.** That includes the planning docs from two sessions ago.
- **Tests** - 3,995 pass and 17 are skipped. None fail. Lint and type checks are clean.
- **Two untracked folders predate this work** - `docs/features/forgiving-job-lookup/` and `docs/research/resume-review/`. Leave them alone.

## Completed This Session

- **Workable job search site** - `lib/parsers/workable.ts` reads `jobs.workable.com/view/{id}/…` links and guesses the employer's board. The search-site mapper is in `lib/utils/workable-fields.ts`.
- **Board-name clash warning** - `lib/handlers/association.ts` warns when a board name already recorded from one parser arrives from another. The wording is in `lib/utils/association-warnings.ts`.
- **BambooHR pay field** - Added as a task this session. The pieces are `readSalaryFromPayText` in `lib/utils/salary.ts`, `rawSalaryFromPayText` in `lib/utils/raw-salary-from-text.ts`, and the `compensation` mapping in `lib/utils/bamboohr-fields.ts`. The feature spec's Approach section was updated to match.
- **Ranking list** - `npm run db:seed` ran against `pipeline.db`. It added the five parsers and five collectors to the bottom of the ranking list.
- **Recover set-aside jobs** - `npm run recover-unparseable-jobs` ran against `pipeline.db`.

## Session Context

- **Decisions** are in the feature decision log. This session added the BambooHR pay entry.
- **Flow test fix** - `workable-search-site.flow.test.ts` now expects the employer name after name tidying. `normalizeCompanyName` drops a trailing period, so "Pet Lab Co." is stored as "Pet Lab Co".
- **Board guesses** - The website guess takes the first label of the registrable domain from `registrableDomainFromUrl`, so "www.ibmc.com" gives "ibmc". A repeated guess is not tried twice.
- **Search-site failures** - A widget request that throws, answers non-ok, or is not JSON only fails that guess. A closed search-site job, answering 410, throws and stays where it was.
- **Clash warning** - It writes a warning only, with no trace row. The job keeps the company holding the board, and no row changes.
- **Pay reader** - `readSalaryFromPayText` drops the currency requirement only for dash ranges. "Between X and Y" wording still needs a currency.
- **Recovery count** - The first recovery run's summary count was cut off in the output. A second run moved 0 jobs and left 96 set aside, on websites no parser owns.
- **Helper tiers** - The middle tier was used for mappers, readers and handler changes. The lowest tier was used once, for a small converter. Its two versions had to be combined for comment quality.

## Next Steps

1. Run `/ship-feature`.
