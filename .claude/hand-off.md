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

Feature: **Unified Job Pipeline** — one feature, twelve phases, on the long-lived branch `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 1 (Collection) is building. Tasks 1 through 9 are done and task 11 is withdrawn; 4 remain.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **task 10, the two browser collectors**.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md` — now 85 acceptance criteria and 14 tasks, one of them withdrawn in place. Read it with `phase-01-collection-r&d.md` beside it.

Working tree is clean. Everything is committed and pushed, including this file.

The pipeline database at `pipeline.db` was recreated on the grown schema and reseeded: one `Setting` row and 21 companies (13 Greenhouse, 3 Lever, 5 Ashby).

## Completed This Session

**Task 8 — collector interface and orchestrator.** `lib/collectors/types.ts` holds the one shape every collector returns. `lib/search-orchestrator.ts` runs them in order, catches each on its own, stamps the collector name onto every job, and pairs every error and warning with the collector that raised it. `lib/collectors/registry.ts` is the only place a collector joins a search. `lib/collectors/ats-boards.ts` warns when a platform has no boards to poll. `scripts/collect.ts` and `npm run collect` run it for real.

**Task 9 — the four API collectors.** Adzuna, JSearch, Greenhouse and Lever, stripped of what served the old pipeline. `lib/collectors/fetch-utils.ts` and `lib/ats-slug-name.ts` came across, the latter now shared with `scripts/db-seed.ts`. `lib/collectors/ats-company-name.ts` holds the board-title stripping and the shared slug fallback.

**Description and salary, after a gap was found.** The schema grew `description`, `salary_low`, `salary_high` and `salary_period`. `lib/salary.ts` turns every source's numbers into one shape and rounds to whole units. All four collectors fill both. Spec stories 67–70 and AC 78–85 cover it.

**weLoveProduct is out.** The site became a paid service. Story 57, AC 56 and task 11 are withdrawn in place, keeping their numbers so nothing citing them shifts.

**A hole in the Phase 7 plan, found by the user.** Phase 7 claimed no parser ever runs on an ATS job. That holds only for jobs an ATS collector produced — an aggregator job resolving to a Greenhouse, Lever or Ashby URL arrives unparsed. All three need a parser there, sharing one field mapper with their collector. `phase-07-parsers-r&d.md` now says so.

**Greenhouse stopped asking twice.** Every posting already carries `company_name`, so the second request per board is gone.

Verified at each step, all exit 0 — `npm run test` 459 across 19 files, `npm run lint`, and `tsc --noEmit`. `dev.db` was read but never written.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. Twelve were added this session.

**Constraints, all measured:**

- **`RequestInfo` is not in this project's type set.** `tsconfig.json` sets `lib: ["esnext"]` with no DOM, so a test typing a captured fetch url as `RequestInfo` passes under Vitest and fails `tsc --noEmit`. Type it `unknown`.
- **A hardcoded column count breaks every time the schema grows.** `lib/job-list-entry.test.ts` now asserts the relationship to the live column list instead. `prisma/schema.test.ts` still keeps two explicit lists, and both must grow together.
- **Registering a collector puts live job-site requests inside `npm run test`** unless `scripts/collect.test.ts` runs the command at `--limit 0`. That is why the flag exists.
- **`npx tsx` cannot resolve modules from the scratchpad directory.** A throwaway probe script has to sit in the repo root.
- **Greenhouse sends salary in cents.** `min_cents: 14000000` is $140,000. Adzuna sends fractional dollars such as `134044.9`. JSearch sends an upper-case period enum. The util takes whole units and rounds; the cents division is Greenhouse's own business.
- **Adzuna truncates every description to 500 characters.**
- **Greenhouse's `/boards/{slug}` endpoint times out intermittently** at the 15-second ceiling. That is what left `Gitlab` on a `GitLab` job before the second request was dropped.
- **Every seeded Lever and Ashby slug answers 200 at the casing stored**, `USMobile` included, which settles the case-sensitivity question AC 37 raises.
- **Lever board titles are already bare names**; Ashby titles always end in ` Jobs`, twice with a doubled space.

**Approaches tried and dropped:**

- **Hardcoding the field count** in `lib/job-list-entry.test.ts`. The plan grows the schema every phase, so the number would need editing each time while catching nothing the missing-field test does not.
- **Asserting exact `salary_raw` strings from the collector tests.** They assert the figures are present instead, so the util's wording can change in one place.
- **`?? undefined` for a description.** A blank string would survive it, and a blank description is no description. `|| undefined` is used.
- **Rounding salary inside each collector.** The util's name promises whole units, so it is the one place that can keep the promise.

**Working with the writer agents.** Two per chunk, tests first and implementation second, with the failing run in between. The two implementations came back near-identical every single time; the test files diverged enough that reading both and combining was worth it. Breaking every guard after green paid off once: the board-title strip passed without its leading space, meaning a company named `Snapjobs` would have lost its tail. A test was added for it.

## Next Steps

1. **Close the open threads first.** All four are small, and two of them shape the tasks below.
   - **JSearch's `employer_name` returned `remote zest jobs`** on a live run, which reads like the query echoed back rather than an employer. Run `npm run collect -- --limit 5` and read what JSearch actually sends. If the field is unreliable, that is the collector's problem to fix before anything else builds on top of it.
   - **Lever's salary needs a ruling.** Lever publishes no salary field, and no parser ever runs on a Lever job, so a Lever job has no salary at all unless its collector reads one out of the description prose. That cuts against "collectors do not parse", and Ashby is about to face the same question in task 12, so settle it before then.
   - **`docs/features/weloveproduct-collector-reliability/` still exists** though its backlog entry is gone. Delete the folder or record why it stays.
   - **AC 66 names five API collectors** while four exist. It closes when task 12 adds Ashby, so this is a thing to know rather than a thing to do.

2. **Task 10 — port the two browser collectors.** Dribbble and uiuxjobsboard. Title read off the card, pagination stop, six-page ceiling, per-search self-checks, modal dismissal, fixture writing. uiuxjobsboard keeps its visible browser. They are the first users of `lib/job-age.ts`. — AC 49–55, 57–60, 62, 65
3. **Task 12 — build the Ashby collector.** Public job board API by slug, `isListed` filter, company name from the board page title through `resolveAtsCompanyName`, and the description and salary an ATS job needs because no parser will fill them. — AC 30, 36–37
4. **Task 13 — wire the `job-search` skill.** Emptied to one step that runs the orchestrator and surfaces errors and warnings first. — AC 19
5. **Task 14 — live one-job command.** Outside the default suite, one job per browser collector, no fixture written. It uses the same `--limit` the collect command already takes. — AC 61, 68–69
6. Each task is built test-first, through `crowd-code` with two writers. Break every guard after it goes green.
