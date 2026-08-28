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

**Phase 1 (Collection) is building. Tasks 1 through 10 are done and task 11 is withdrawn; 4 remain.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **task 15, the description reader**, which is built before task 12 and numbered last so nothing citing the earlier numbers shifts.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md` — now 97 acceptance criteria and 15 tasks, two of them withdrawn in place. Read it with `phase-01-collection-r&d.md` beside it.

Working tree is clean. Everything is committed and pushed, through `c18865d`.

## Completed This Session

**The four open threads from the last hand-off are closed.** JSearch's odd employer name was measured live and left alone. The Lever salary question grew into task 15. The weLoveProduct folder is deleted. AC 66 is a thing to know, not a thing to do.

**Task 10 — the two page-reading collectors.** Dribbble and uiuxjobsboard, both built test-first through `crowd-code`, both registered, both verified against the live sites. Dribbble returned 6 real jobs in 1.2 seconds; uiuxjobsboard returned 105 in 1.5.

**Neither opens a browser.** Both sites send finished html, so `lib/collectors/fetch-page.ts` fetches a page and hands back one element's markup. `browser.ts` and its 13 tests were built and then deleted.

**The machinery underneath them.** `paginate.ts` walks result pages with the stop rules and per-search self-checks. `fixture.ts` saves a results container and decides which one. `dribbble-cards.ts` and `uiuxjobsboard-cards.ts` each read cards from html, and the same function serves the live page and the committed fixture.

**`linkedom` was added** so page-reading code runs in plain Node. It is noted in `CLAUDE.md` and in the Phase 7 plan, whose parsers read pages with hand-written patterns today.

Verified at each step, all exit 0 — `npm run test` 666 across 27 files, `npm run lint`, and `tsc --noEmit`. Every guard was broken afterwards to prove a test caught it; 4 survived, and each got a test.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. Nine were added this session, two of them superseding earlier entries.

**Constraints, all measured:**

- **`import.meta.dirname` is undefined under tsx** and filled in under vitest. A path built from it passes every test and throws the first time a real command runs. Use `path.dirname(fileURLToPath(import.meta.url))`.
- **Both sites are fully server-rendered.** A plain `fetch` returns the same cards Playwright did — 13 on a Dribbble remote search, 100 on a uiuxjobsboard category page.
- **Dribbble serves its whole result set on one page.** `?page=2` comes back empty, `offset` and `p` are ignored, scrolling loads nothing, and there is no load-more control. A bare search caps at 40 cards.
- **Dribbble accepts the zip `78701`** in its `location` parameter and resolves it to Austin, TX, so the settings location needs no mapping.
- **Dribbble's boosted and featured cards carry no `.posted-on` element at all.** Treating one as an unreadable age would stop every search on its first card.
- **A Dribbble search that matches nothing renders no results container at all**, so reading it must tolerate the element's absence rather than throwing.
- **uiuxjobsboard's category pages serve 100 cards in one load**, newest first, with no scroll loading and no next-page control.
- **uiuxjobsboard's `h3` text runs the company, the words "is hiring", and the title together** as one string. The title is `span.text-2xl`.
- **uiuxjobsboard's featured cards put a badge in `div.text-sm`** where the age belongs.
- **JSearch's `employer_name` holds the publishing job board's name** when it cannot identify an employer — 4 of 10 on a live remote search, each matching `job_publisher` exactly.
- **"Founding Design" matches nothing on Dribbble**, so that one search warns on every run. It is honest, not a fault.
- **The high-severity `ws` advisories come from `@libsql/client`**, not from `linkedom`. They predate this session.

**Approaches tried and dropped:**

- **Playwright for both collectors.** `browser.ts` was built and tested, then deleted once both sites proved server-rendered. A request takes a second where a browser took a minute, and it drops the waiting guesses that cause most of a scraper's random failures.
- **Driving uiuxjobsboard's search form.** Its category paths replace the form outright, which is what removed the visible browser, the region passes, and the scrolling together.
- **Judging the fixture on the whole run's self-check.** One search always matches nothing, so every run failed and the fixture froze forever.
- **Keeping the last search that had cards as the fixture.** That left a real fixture holding a single card, which proves almost nothing about the markup. `pickFixture` keeps the strongest container instead.
- **A per-page "richest read" guard inside `readPage`.** `advance` always answers false today, so `readPage` runs once per search and the guard could not differ from a plain assignment. Two mutations survived because of it, and it was removed.
- **Reading the company name off a result card.** Both sites show it, but resolution and parsing reach the source posting and write it from there.

**Working with the writer agents.** Two per chunk, tests first and implementation second, with the failing run in between. This is not optional and not a judgement call — dropping to one writer mid-session was corrected by the user. The implementations came back near-identical every time; the test files diverged enough that reading both and combining was worth it.

## Next Steps

1. **Task 15 — read salary and work mode out of an ATS description.** Two shared text utils, called by an ATS collector only where its source published neither. Greenhouse, Lever and Ashby all wire to them. `legacy/lib/scrapers/fetch-utils.ts` holds `parseSalaryFromText` and `detectWorkModeFromText` to adapt rather than copy. The user's ruling: take a fair stab, and an attempt that finds nothing leaves the fields empty. — AC 86–95
2. **Task 12 — build the Ashby collector.** Public job board API by slug, `isListed` filter, company name from the board page title through `resolveAtsCompanyName`, and the description and salary an ATS job needs because no parser will fill them. It closes AC 66, which names five API collectors while four exist. — AC 30, 36–37
3. **Task 13 — wire the `job-search` skill.** Emptied to one step that runs the orchestrator and surfaces errors and warnings first. — AC 19
4. **Task 14 — live one-job command.** Outside the default suite, one job per page-reading collector, no fixture written. It uses the same `--limit` the collect command already takes. — AC 61, 68–69
5. Then **Plan phase 2 — Tracing**, following the phase planning procedure.
