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

Feature: **Unified Job Pipeline** — a long-lived branch, `feature/unified-pipeline`. Job searches run from `main`.

**Phase 7, URL Resolution, is six tasks into eighteen.** Its spec is at [`phases/phase-07-url-resolution-spec.md`](../docs/features/unified-pipeline/phases/phase-07-url-resolution-spec.md). Six of fourteen phases are closed; phase 7 is the seventh and is mid-build.

**1,793 tests across 71 files pass, `npm run lint` exits 0**, both verified fresh at close.

**Four commits, pushed** — `4fc2f70..1aa2fe5` on `feature/unified-pipeline`.

| Commit | What it carries |
| --- | --- |
| `afb1782` | Tasks 1 to 4 — `lib/blacklist.ts`, `lib/url-domain.ts`, `lib/dead-end-signals.ts`, `lib/apply-links.ts` |
| `254f424` | Task 5 — `lib/resolution-page.ts`, `lib/resolution-page.fake.ts` |
| `fbe3422` | Task 6 — `lib/decide-next-action.ts` |
| `1aa2fe5` | Tasks 1 to 6 checked in `docs/CURRENT-FEATURE.md` |

**One uncommitted line:** `docs/features/unified-pipeline/decision-log.md` gained a single entry at session close and has not been committed.

## Completed This Session

Phase 7 tasks 1 to 6, each built through `crowd-code` with its tests.

- **Tasks 1 to 4 are the unchanged ports** — the blacklist, `extractDomain`/`isSameDomain`, `detectDeadEndSignals`, and `APPLY_LINK_PATTERNS`/`filterApplyLinks`. Their legacy tests came across as written, regrouped under the acceptance criteria they cover.
- **Task 5 is the fake `Page`**, which blocked tasks 6 to 8 because nothing in this codebase faked one.
- **Task 6 is the first genuine rewrite** — `decideNextAction` loses the `uncertain` outcome, both hardcoded domain branches, and every host comparison.

## Decisions & Context

**The one decision the user made is in the decision log**, dated 2026-09-11: the fake `Page` is driven by a walk scripted up front rather than a URL-to-page lookup. What follows lives nowhere else.

### The uiuxjobsboard hydration problem does not reproduce

The phase 7 r&d's open question on the settle condition rests on this claim: a uiuxjobsboard posting's real destination "sits in the hydration payload and becomes an anchor only after React runs." Measured on three live postings, twice — once in a headless browser sampling from t=0 to t=4000ms, once by plain `fetch` with no browser at all — the off-host ATS link is in the raw server markup, alongside 88 or 89 anchor tags and a non-empty title, before any JavaScript runs. The spike's settle test passes immediately **and** the link is already there.

That measurement is strong for those three postings on 2026-09-11 and nothing further. It does not establish that the r&d was wrong when written; the site may have changed, or the original observation may have concerned the specific reddit posting it names. **Settling is still needed** — the research doc measures Adzuna's `/land/ad/` interstitial at 0/20 escaping without it and 20/20 with it.

### Calls made while building, none of them user decisions

- **`decideNextAction(applyLinks, hopBudgetRemains)`** drops `currentUrl` and takes a boolean rather than `depth`/`maxDepth`. Nothing in it compares hosts any more, and the four-hop ceiling stays in the loop.
- **`PageAnchor` exists instead of adding `"dom"` to the tsconfig `lib` array.** Adding the DOM library is a project-wide change and out of scope.
- **The fake resolves hrefs by rewriting each anchor's attribute** against the page URL, because a browser reports `a.href` absolute and linkedom does not.
- **File names** are `url-domain.ts`, `dead-end-signals.ts`, `apply-links.ts`, `decide-next-action.ts`, `resolution-page.ts`.
- **`APPLY_LINK_PATTERNS` stays module-private** — nothing outside reads it.
- **The session was committed as four commits by goal** rather than one.

These six are work-documentation under the decision-log rule and belong in the feature spec. **They have not been written anywhere** — the user was asked and had not answered by close.

### Gotchas found this session

- **A real Playwright `Page` is assignable to a narrow structural subset of itself**, `$$eval` with a custom element type and `on`/`off` for `"response"` included. Verified by compiling against the real types rather than assumed. That is what lets the walk take a real page and a fake with no adapter.
- **This project builds with `"lib": ["esnext"]`** — no DOM types. `Element` resolves to a name with no members, so it typechecks until something reads `.href` off it and then fails with TS2812. `lib/collectors/dribbble-cards.ts` already works around this by deriving its element type from linkedom.
- **Vitest does not typecheck.** esbuild strips types, so a test file full of type errors passes under `npx vitest run` and fails only under `tsc --noEmit`. For a type-level test, `npm run lint` is the only gate that bites.
- **linkedom does not resolve hrefs.** `<a href="/jobs/1">` reads back as `/jobs/1` from both `.href` and `getAttribute("href")`, and an anchor with no href gives `""` from `.href` and `null` from `getAttribute`. Setting the attribute to an absolute URL makes `.href` return it.
- **The commit hook's "test gap" report is attributed to the wrong file set** — it named the fake's internals while committing `decideNextAction`, and `isModalTrigger` while committing a markdown file. All the symbols it flagged are covered. Do not act on it without checking.

### Approaches tried and abandoned

- **Typing `$$eval`'s elements from linkedom** via `ReturnType<typeof parseHTML>`. It compiles and a real `Page` still satisfies it, but it puts linkedom into a production interface. `PageAnchor` replaced it and needs no cast at either end.
- **Adding `"dom"` to the tsconfig `lib` array** to make `Element` usable. Rejected as a project-wide change well beyond this task.
- **An `as unknown as Element[]` cast inside the fake.** Needed only while the interface still said `Element[]`; removed once `PageAnchor` existed.

### Open questions

1. **How the settle condition reads the page.** The spike's `settleClientRedirect` uses `page.evaluate`, `page.waitForURL` and `page.waitForLoadState`, none of which are in `ResolutionPage`. Either poll with what the interface has — `$$eval("a", …)`, `title()`, `url()` — on a short interval, or extend the interface with the two wait methods and port the race as written. Polling was recommended and not confirmed. The research doc's warning is against *a plain 4s wait with no race*, which a short poll is not.
2. **Whether to correct the phase 7 r&d's open-question entry** with the uiuxjobsboard measurement above.
3. **Whether to add the six work-documentation items to the feature spec.**

### Carried forward, still true

`cat` is blocked over 2048 bytes — use `sed -n` or Read. `grep -r --include` needs the pattern quoted. `timeout` is not on PATH. `PIPESTATUS` does not survive; capture `$?` directly instead. `npm run lint` runs ESLint then `tsc --noEmit`. A scratchpad script reaches `node_modules` by symlinking it in, and both of this session's probes ran that way with no spike code left in the repo. `dev.db` at the repo root is the legacy database; `pipeline.db` is the new one and still holds 20 jobs, 31 companies. Anything new under `lib/steps/` loads `pipeline-steps.md` and `naming.md`. Rule edits go through `writing-rules`, skill edits through `writing-skills`. A `docs/BACKLOG.md` change needs approval first. Questions are plain text. Every message over one paragraph ends with a TL;DR.

**Production code is written through `crowd-code`, never edited directly.** The user corrected this mid-session. Writing the failing test first is the session's own job under crowd-code Phase 2; everything the writers produce is theirs.

## Next Steps

1. **Answer open question 1** — poll versus extending `ResolutionPage`. Task 7 cannot start without it.
2. **Build task 7, the settle condition**, covering criteria 44 to 46: a page that already looks finished returns without waiting, a page that navigates away is judged where it landed, and a page that never settles is judged as it stands rather than failing. The spike's test is 5 or more anchors **and** a non-empty title; the research doc records the title half as load-bearing, since `gdit.dejobs.org` mid-render had exactly 5 anchors and an empty title.
3. **Task 8, the hop loop** — the response-status check opens it, and it holds the URL it stood on before each hop so a same-domain hop can be discarded. This is where rule 3 lives, judged after landing.
4. **Then tasks 9 to 18**, which move into the database and the step: widening `delete_on_save`, the job-list read, the concurrency setting, the step itself, `runResolution`, the dedupe set-aside, the `leavingRow` retrofit, the save warning, Dribbble self-resolving, and the trace vocabulary.
5. **Commit the decision log's uncommitted line** with whatever lands next.
6. **`architecture.md:110` and the phase 5 and 6 specs still encode the old `abandoned` meaning.** That stays correct until task 15 lands, which supersedes those specs' criteria; phase 7's close updates the architecture doc.
