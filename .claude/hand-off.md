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

Feature: **Unified Job Pipeline** — thirteen phases on the long-lived branch `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 1 (Collection) is building. Tasks 1 through 16 are done; two remain.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **task 17, wiring the `job-search` skill**.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md`. Read it with `phase-01-collection-r&d.md` beside it. It keeps **two parallel numbered lists** — User Stories 1–78 and Acceptance Criteria 1–111. A reference like "AC 33" always means the criteria list. Confusing the two is how four stale criteria once survived an audit.

**Committed and pushed through `fcc4bda`.** Three doc files are modified and uncommitted: this hand-off, `phase-01-collection-r&d.md`, and `phase-02-tracing-r&d.md`. The last two carry findings recorded during hand-off, described below.

## Completed This Session

**Task 15 — the Ashby collector.** `lib/collectors/ashby.ts` with 38 tests, registered after Lever. Polls each seeded slug at `api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`, keeps postings where `isListed` is true whose title matches the search terms, and writes the `jobUrl` Ashby supplies to both `original_url` and `resolved_url` rather than rebuilding it from slug and id. `raw_company_slug` alone, no name. `publishedAt` fills `posting_date` only. Committed as `e692d14`.

**Task 16 — a collected job that cannot travel is dropped.** `lib/collectors/job-usable.ts` with 27 tests, called from the orchestrator's per-collector loop with 13 more tests there. Committed as `fcc4bda`.

**Verified:** `npx tsc --noEmit` exit 0, `npm run lint` exit 0, `npm run test` exit 0 with **832 passing across 31 files**, up from 755. A live orchestrator run over the five seeded Ashby boards kept all 53 real jobs with 0 dropped, 0 errors, 0 warnings.

## Decisions & Context

Signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — it is the authority. Three were added this session: `isRemote` is not collected, the drop rule, and why the check lives in the orchestrator.

**Where this session's other findings already live, so they are not re-derived:**

- **Phase 1 spec** — AC 104–111 state the drop rule. The task list renumbered: `job-search` is now 17, the live one-job command 18.
- **Phase 1 r&d, Open questions** — four source assumptions that fail silently and are still unguarded.
- **Phase 2 r&d, Carried in from Phase 1** — a source that answered but sent nothing is Tracing's to surface, not collection's.
- **Phase 3 r&d** — normalization drops a malformed salary field rather than the job; its `isRemote` question is answered with the measurement.
- **Phase 9 r&d** — what expiry does with a job carrying no date at all.

**Measured live on 2026-08-28, all five seeded Ashby boards, 2,818 jobs:**

- **Ashby has no cross-board search and no date filter.** `updatedAfter`, `publishedAfter`, `since`, and `modifiedAfter` are all ignored and return the full set; `includeCompensation` is the only parameter. An 8-day client-side filter on `publishedAt` would cut 53 matching jobs to 8 permanently, since `publishedAt` never moves. This is why the collector has no date guard — classification handles age.
- **The salary is never the first `summaryComponents` entry.** Equity frequently is, carrying nulls. No posting carries more than one `Salary` entry, and none hides one in `compensationTiers` that `summaryComponents` omits.
- **`interval` and `currencyCode` must not be hardcoded.** Live values are `1 YEAR` ×201, `1 MONTH` ×12, `1 HOUR` ×1; USD ×194, EUR ×17, CAD ×3.
- **`isListed` is true on every live job**, so only a fixture exercises that filter.
- **`bjakcareer` returns 2,338 jobs in one response** and the flat 15-second timeout handled it. A data point for backlog item 23, Large Board Payload Handling.

**Constraints and gotchas:**

- **`limit` bounds nothing in a normal run.** It defaults to `Infinity`, is set only by `--limit N` on `scripts/collect.ts`, and is per collector rather than per run. It stops jobs entering the list, not requests being made — Ashby's 2,338-job board is one fetch that completes in full before any limit is consulted.
- **The orchestrator's finish line now reads `kept=N dropped=M`**, and omits the dropped half when nothing was dropped. `found=` is gone, because it would hide the gap this check exists to surface.
- **`makeJob` in `search-orchestrator.test.ts` needed a company added.** It supplied only a URL and a title, so every fixture job would have been dropped. Any new orchestrator fixture needs all three.
- **crowd-code writers returned HTML-escaped output on all ten dispatches this session** — `&quot;`, `&amp;`, `&gt;` — every agent, every round, both tiers. Unchanged from the previous session's note. Check before applying.
- **The commit hook's test-gap warning fired this session** on five non-exported internals covered through their public callers, after reporting zero gaps last session. Intermittent, and it flags internals.
- **`npx tsx -e` cannot run top-level await** — it fails with `"cjs" output format`. Write a real file. A scratch script outside the repo also cannot reach `lib/` by relative path; absolute paths work.

**Open questions:**

- The four silent source assumptions in the Phase 1 r&d. The per-job usability check does not catch them, because they produce well-formed jobs with quietly wrong data. Whether to guard them is undecided.
- **Backlog item 4, "Ashby API Collector", is now built.** Its entry says it "stays here until it is actually built", so it should be removed.
- The Phase 3 and Phase 4 questions carried in their r&d files: whether Association's two passes differ, whether JSearch's employer name can be trusted for a match, whether a slug match should correct a stale seeded name, and what normalizing a title does.

## Next Steps

1. **Task 17 — wire the `job-search` skill.** Emptied to one step that runs the orchestrator and surfaces errors and warnings before anything else. Its current step 1 already fails on this branch: it imports `./lib/collectors/collect-all`, and `lib/` is now `legacy/lib/`. — AC 19
2. **Task 18 — live one-job command.** Outside the default suite, one job per page-reading collector, no fixture written. Kept out of `npm run test` because a live site would block unrelated commits. — AC 61, 68–69
3. Commit the three modified doc files.
4. Then **Plan phase 2 — Tracing**, following the phase planning procedure. It already carries three obligations from Phase 1: retrofitting traces into all seven collectors, tracing the search-term drop, and surfacing a source that answered but sent nothing.
