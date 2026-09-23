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

**Feature:** Multi-Field Board Identity Parsers. Branch `feature/multi-field-board-identity`. Spec at `docs/features/multi-field-board-identity/feature_spec.md`, task list in `docs/CURRENT-FEATURE.md`.

**All nine tasks are built and checked.** Every flow test passes. The full suite passes: 185 files, 3,671 tests. Lint and type check are clean.

**The feature is not shipped yet.** The user wants three checks on the real database before `/ship-feature`. They are listed in **Next Steps**.

**Nothing is committed.** Uncommitted work includes both sessions' code and tests, the migration `prisma/migrations/20260923155709_add_identifying_query_values/`, and the planning docs. It also includes unrelated changes from other sessions: `docs/BACKLOG.md`, the deleted `.claude/skills/goal-w-context/SKILL.md`, the deleted theirstack r&d file, and the new folders under `docs/features/` and `docs/research/`.

**New files this session:**

- `lib/utils/workday-fields.ts` and `lib/utils/ultipro-fields.ts` - Shared helpers: board read off a link, board split back into parts, addresses, field mapping.
- `lib/parsers/workday.ts` and `lib/parsers/ultipro.ts` - The two parsers.
- `lib/collectors/workday.ts` and `lib/collectors/ultipro.ts` - The two collectors.
- `scripts/recover-unparseable-jobs.ts` - Moved from `recover-greenhouse-jobs.ts`, now asks the parser registry. Its test moved with it.
- A test file beside each new code file.

**Changed files this session:** the Greenhouse, Lever and Ashby collectors and their tests, both registries, `lib/handlers/company-promotion.ts` and its test, `package.json`, `lib/parsers/registry.test.ts`, `lib/parsers/resolved-addresses.fixture.json` and `scripts/db-seed.test.ts`.

**The real database changed.** The seed added `parser:workday`, `parser:ultipro`, `collector:workday` and `collector:ultipro` to the bottom of the source ranking list.

## Completed This Session

- **Workday parser** - Reads a posting from Workday's data address and records the board as `company:datacentre:site`.
- **UltiPro parser** - Reads the job held in the posting page's script and records the board as `companycode:boardid`.
- **Existing collectors skip a broken board** - Greenhouse, Lever and Ashby now skip a board whose reply isn't job data, or whose request fails, and warn about it.
- **Workday collector** - One search per term, 20 jobs a page, stopping at a page with no match, an empty page, or 50 pages.
- **UltiPro collector** - Reads a whole board 200 jobs at a time until a reply comes back short.
- **Promotion covers the new boards** - Workday and UltiPro were added to promotion's list of pollable systems.
- **One recovery command for every parser** - `npm run recover-unparseable-jobs` replaces `recover-greenhouse-jobs`.

## Session Context

The user decided nothing new this session. The feature decision log is unchanged. Three calls made while building are written into the spec's Approach section: UltiPro boards are stored in lower case, the Workday stop rule checks only the term being searched, and the UltiPro request body is minimal.

**Other calls made while building:**

- **Workday dates** - The collector leaves a job's date empty. The list gives an age such as "Posted 30+ Days Ago", not a date. The parser fills the real start date from the posting.
- **Workday repeats** - A page holding only jobs already collected counts as "no match" and ends that term. Without this, a board repeating a page would be read 50 times.
- **Workday employer name** - Neither the parser nor the collector records one. Workday's name is a legal entity name, which would split one employer into two companies.
- **UltiPro has no page limit** - The collector stops only when a reply comes back short, as the spec says. Nothing caps the number of pages. No board has been seen ignoring the starting point.
- **UltiPro links** - The collector writes a job's link in the lower-case form stored links take, so both forms produce the same matching key for duplicates.

**Gotchas:**

- **Copied lists in tests** - `lib/parsers/registry.test.ts` and `scripts/db-seed.test.ts` each keep their own copy of the source lists on purpose. Every new parser or collector means updating both.
- **Unexplained failure count** - One full run counted 8 failing files instead of the expected 7. Three later runs didn't repeat it, and the cause is unknown.
- **Slightly wrong comment** - The comment on `ultiproPostingUrl` in `lib/utils/ultipro-fields.ts` says lower case suits "resolvers". Only duplicate matching depends on it.
- **Commands list** - `CLAUDE.md` doesn't list `recover-unparseable-jobs`. It never listed the old command either.
- **Live requests** - Read-only test requests were sent to the real UltiPro board `tel1010tefo` on 2026-09-23. They confirmed the short request body and the paging.

**Open thread:** Whether one-line edits in crowd-code could use one writer instead of two. It's still undecided, and two were used throughout.

## Next Steps

The user's order, before shipping:

1. **Recover the set-aside jobs.** Run `npm run recover-unparseable-jobs` on the real database. Measured 2026-09-21, about 42 set-aside jobs sit on Workday or UltiPro. They should return to `backlog`, and jobs on websites no parser owns should stay put. Show the user the command's printed counts.
2. **Re-order the source ranking list.** The four new names sit at the bottom of `source_priority_list`, below every collector. So a Workday or UltiPro parser loses every field an aggregator also supplies. Ask the user where each should rank, then write the new order.
3. **Run a job search.** Run `npm run job-search`, then the `job-search` skill's scoring. Check that the recovered Workday and UltiPro jobs get a description and location, and that their boards are recorded. Check that the run's warnings name nothing unexpected.
4. **Ship.** If all three look right, run `/ship-feature`. If not, fix what broke first.
