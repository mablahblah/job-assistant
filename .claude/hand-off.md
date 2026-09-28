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

- **Feature** - General Purpose Parser Safety Net, on branch `feature/general-purpose-parser`. Spec: `docs/features/general-purpose-parser/feature_spec.md`. All nine tasks are checked in `docs/CURRENT-FEATURE.md`. The feature looks ready to ship.
- **Nothing is committed** - The work from this session and the one before it is all uncommitted.
- **Tests** - All 4,152 pass, including the 8 general-parser flow tests. Lint and the type check are clean.
- **New files** - `lib/parsers/general.ts`, `lib/utils/job-posting-data.ts`, `lib/utils/page-text.ts`, `lib/tools/page-fetcher.fake.ts`, each with a test. 8 flow tests: 7 in `lib/orchestrators/` and 1 in `scripts/`. `docs/features/employer-scoring-follows-job-list/`.
- **Changed code** - `lib/parsers/registry.ts`, `parser.ts`, `dribbble.ts`, `lib/handlers/parsing.ts`, `lib/orchestrators/job-search.ts`, `lib/utils/source-priority.ts`, `lib/tools/page-fetcher.ts`, `lib/tools/rendered-page-fetcher.ts`, `scripts/db-seed.ts`, `prisma/schema.prisma` (comment only), their tests, and `package.json`.
- **Changed docs** - Criteria struck through and dated in three places: this feature's spec (the page-text location criterion), `_complete/ats-parser-expansion/feature_spec.md` (two criteria), and `_complete/multi-field-board-identity/feature_spec.md` (one). `docs/BACKLOG.md` gained item 11.

## Completed This Session

- **Registration** - `parserForUrl` hands the general parser any web link no dedicated parser owns or claims, after Greenhouse's check. `npm run db:seed` adds `parser:general` last.
- **Parsing step** - A second try with the general parser after a dedicated parser throws or reads nothing. Jobs with no link are judged on their collector's details, with no fetch. A dead page gives `expired` with reason `dead_page`. A job the general parser handles with no real place gives `unparseable` with reason `no_location`. Page-text places are added to the job's places. One trace row per job.
- **Parsing browser** - `runJobSearch` takes `launchParsingBrowser`. It opens one browser only when a parser first asks for a rendered page, and closes it after parsing.
- **Ranking** - `sideRank` ranks a copy that carries a parser by that parser's entry.
- **Trace vocabulary** - The parsing reasons are written down in the Trace model's comment in `prisma/schema.prisma`.
- **Real database, `pipeline.db`**
  - The seed added `parser:general`.
  - The user reordered the ranking: `collector:user`, then the six original parsers, the five newer parsers, `parser:general`, then all 15 collectors.
  - `npm run recover-unparseable-jobs` moved 135 set-aside jobs to the backlog.
  - One full job search ran (`45851040-9c83-471f-9658-fc68c84bb4cb`) and was scored. 69 jobs were scored, and 3 had unreadable postings. 69 employers were saved, 55 of them only partly scored.

## Session Context

- **Decisions** - They are in `docs/features/general-purpose-parser/decision-log.md`. This session replaced the page-text location entry.
- **How page-text places travel** - The general parser hands page-text places back as `added_location_list`, a field declared on `ParsedFields` in `lib/parsers/parser.ts`. `parsing.ts` adds them to the job's `raw_location_list` and strips the field. Job-data places stay in `raw_location_list` and replace the job's places like any other field.
- **The reasons live in parsing** - `parsing.ts` records `dead_page` and `no_location` itself, because every outcome needs a reason. The last task only had to write them into the schema comment. Parsing no longer writes `no_parser_for_domain`, `parser_errored` or `nothing_parsed`. `run-summary.ts` still labels any reason other than `no_parser_for_domain` as "parser failed".
- **The closed-posting test changed** - `hiring-systems-closed-posting.flow.test.ts` now checks that parsing recorded `job_parsed` with `dead_page`, not the final status. Promotion still returns expired jobs in the same search, which is tracked as Dead Postings Stay Expired.
- **Refused links never reach parsing** - Of the 34 jobs still unjudged, 26 had their link refused during resolution (`page_refused`). Parsing only reads resolved jobs, so the collector fallback never runs for them. Another 5 had locations classification couldn't use, and 3 had unreadable postings. 1 left no trace this run and hasn't been looked into.
- **Scoring uses up web searches** - A run with about 70 employers used up the session's 200 web searches. Later helpers fell back to direct page reads, and one used the user's Chrome through Claude in Chrome. Microsoft was left unscored on purpose: its helper scored from memory without marking guesses.
- **Employer scoring bug** - Scoring's employer list ignores the job list's readiness checks. It's logged as backlog item 11, Employer Scoring Follows the Job List.

## Next Steps

1. **Commit** - Commit all work on `feature/general-purpose-parser`.
2. **Ship** - Run `/ship-feature`. The decision log already records that `npm run recover-unparseable-jobs` is run once at ship. That was already done this session, so it doesn't need running again.
3. **Look into the untraced job** - Optionally, find the one unjudged backlog job with no trace in run `45851040`.
