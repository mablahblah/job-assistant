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

**Phase 7, URL Resolution, is eight tasks into eighteen.** Its spec is at [`phases/phase-07-url-resolution-spec.md`](../docs/features/unified-pipeline/phases/phase-07-url-resolution-spec.md). Six of fourteen phases are closed; phase 7 is the seventh and is mid-build.

**1,816 tests across 73 files pass, `npm run lint` exits 0**, both verified fresh at close.

**Four commits, pushed** — `1aa2fe5..064166d` on `feature/unified-pipeline`.

| Commit    | What it carries                                                              |
| --------- | ---------------------------------------------------------------------------- |
| `5dada7c` | The previous session's decision-log entry and hand-off                       |
| `5281563` | Task 7 — `lib/settle-page.ts`, and the fake's time axis                      |
| `b0979af` | Task 8 — `lib/resolve-job-url.ts`, and `unfollowedUrl` on `decideNextAction` |
| `064166d` | Tasks 7 and 8 checked in `docs/CURRENT-FEATURE.md`                           |

**One uncommitted line:** `docs/features/unified-pipeline/decision-log.md` gained the polling decision at close. This is the second session running to end that way.

## Completed This Session

Phase 7 tasks 7 and 8, four changes, each built through `crowd-code` with its tests.

- **Task 7 is the settle condition**, `lib/settle-page.ts`. It returns immediately when the page carries five or more anchors **and** a non-empty title, and otherwise polls — 150ms interval, 15s budget by default — until the page finishes or the budget is spent. It never throws. A read that throws `"Execution context was destroyed"` counts as progress rather than an abort, because that error means the page navigated, which is what settling waits for. The clock and the sleep are injected, so its tests are deterministic and instant.
- **Task 7 also gave the fake a time axis**, because a settle condition cannot be tested against a page that never changes. A `ScriptedPage` carries `becomes`, an ordered list of later renders each able to change `url`, `html` or `title`, and the returned page carries `advance()`. Advancing past the last render and advancing before any `goto` are both no-ops. All 17 pre-existing tests were untouched.
- **Task 8 is the hop loop**, `lib/resolve-job-url.ts`, bounded by a counted loop at four hops. Each hop installs a `"response"` listener, loads, settles, reads the status of the page it landed on, checks the blacklist against the settled URL, checks for a dead end, then collects apply links and decides. It holds the URL it stood on before each hop, which is what lets a same-host hop be discarded.
- **Task 8 also widened `decideNextAction`** so `budget_spent` carries `unfollowedUrl`.

## Decisions & Context

### The one decision the user made

**Settling polls through the existing `ResolutionPage`** rather than extending it with Playwright's `waitForURL` and `waitForFunction`. It is in the decision log, dated 2026-09-11. What follows lives nowhere else.

### Calls made while building, none of them user decisions

- **Task 8 is two files rather than one.** The hop-budget rule needs the link that was not followed, and re-deriving the modal-trigger test in the loop would be a second implementation of it.
- **Five tests for the settle condition**, reading `crowd-code`'s "one minimal test" as one _behaviour_ per test. The unit carries three acceptance criteria plus the navigation gotcha, and one test would have left the writers free to fail two of them.
- **A URL change during settling is progress, not an exit.** Settling continues on the page it landed on, which is what the measured spike does.
- **`ResolutionOutcome` is three-way** — resolved, failed, blacklisted — and names no job fields and no trace rows. The step turns it into both. The blacklisted case carries no URL, because the collector decides whether the job is dropped or takes `unresolvable`, and neither writes a `resolved_url`.
- **Writer selections.** The fake combined Writer B's extracted render-sequence helper with Writer A's single source of truth. `settle-page.ts` took Writer B unmodified, because pairing the two reads through `Promise.all` narrows the window in which an old page's anchor count pairs with a new page's title. The hop loop took Writer B, because a counted loop makes the four-page ceiling structural rather than a consequence of the budget flag, and its listener detaches before the content and link reads.
- **`landedUrl` is initialised to `""`** to satisfy definite-assignment analysis across the `try`/`finally`.

These are work-documentation under the decision-log rule and belong in the feature spec. **They have not been written anywhere** — see open question 2.

### Gotchas found this session

- **The commit hook's "test gap" report is misattributed**, confirming the previous session's finding. It named `hopRenders`, `fakeResolutionPage`, `requireCurrentRender`, `goto` and `url` while committing two markdown files, and claimed 7 and 9 changed files on commits containing 2 and 4. Every symbol it flagged is covered. Do not act on it without checking.
- **`$?` after a pipe is the last command's, not npm's.** `npm run test | tail` then `$?` reports `tail`. Redirect to a file and check `$?` directly.
- **tsconfig has `strict: true` but not `noUncheckedIndexedAccess`**, so array indexing types as non-undefined and an index guard is unnecessary.
- **ESLint carries no `curly` rule and no formatter**, so brace style is a readability call rather than a gate.
- **`/change-status` does not work on this branch.** It calls `npx tsx scripts/cli.ts`, and the CLI is at `legacy/scripts/cli.ts` here. `dev.db` holds two Omada Health jobs — Staff Product Designer at `won't apply`, Senior Product Designer at `expired`. A status change to `rejected` was requested this session, the ambiguity was raised, and nothing was written.

### Approaches tried and abandoned

- **Extending `ResolutionPage` with `waitForURL` and `waitForFunction`.** Faking them means writing a polling loop inside the fake, where no test covers it.
- **Writer A's short-circuited settle read**, which skips the title read when the anchor count is already too low. Fewer round trips on a stuck page, but it widens the window in which an old page's anchor count pairs with a new page's title.
- **Writer A's unbounded `for(;;)` hop loop.** Correct, but the four-page ceiling then rests entirely on the budget flag rather than on the loop itself.

### Open questions

1. **What splits `job_resolved` from `resolution_failed` when the four-hop ceiling is reached with a link unfollowed.** Built as: an unfollowed link on the same host as where the walk stands resolves there with reason `hop_budget_spent`; off-host fails with the same reason. Sourced from the phase 7 r&d line 71 — "where the ceiling is reached with an off-domain link still unfollowed" — and the spec's trace table, which agree. **The user never decided it**, and it is running in `lib/resolve-job-url.ts` now. It is also the one place a link is judged by its own href rather than by where the browser landed, which cuts against the decision that the same-domain test runs after landing; there is no budget left to land on it, so the href is the only evidence available.
2. **Whether ten work-documentation items go in the feature spec.** Six carried from the previous session: `decideNextAction`'s signature, `PageAnchor` instead of adding `"dom"` to the tsconfig `lib` array, the fake resolving hrefs by rewriting attributes, the five file names, `APPLY_LINK_PATTERNS` staying module-private, and committing by goal. Four from this session, listed above under calls made while building.
3. **Whether to correct the phase 7 r&d's open-question entry** with the previous session's uiuxjobsboard measurement.

### Carried forward, still true

`cat` is blocked over 2048 bytes — use `sed -n` or Read. `grep -r --include` needs the pattern quoted. `timeout` is not on PATH. `npm run lint` runs ESLint then `tsc --noEmit`, and vitest does not typecheck, so lint is the only gate that catches a type error. `dev.db` at the repo root is the legacy database; `pipeline.db` is the new one. Anything new under `lib/steps/` loads `pipeline-steps.md` and `naming.md`. Rule edits go through `writing-rules`, skill edits through `writing-skills`. A `docs/BACKLOG.md` change needs approval first.

**Production code is written through `crowd-code`, never edited directly.** Writing the failing test first is the session's own job under crowd-code Phase 2; everything the writers produce is theirs.

Backlog entry 26, **Resolver Refinements**, holds six deferred improvements to this walk, each waiting on a measured failure from a real run. Nothing this session produced one.

## Next Steps

1. **Answer open question 1** — the hop-budget split is running on inference rather than on a decision.
2. **Commit the decision log's uncommitted line** with whatever lands next.
3. **Task 9, widening `delete_on_save` to admit `blacklisted_url`** — the first task of this phase that touches the database rather than the walk, covering criterion 60.
4. **Task 10, the resolution job-list read** on the job service and its fake: every job whose status is `backlog` and whose `is_resolved` is false, whenever it was collected, carrying `id`, `collector` and `created_at` and leaving the four flags behind. Criteria 1 to 4.
5. **Then tasks 11 to 18** — the concurrency setting, the step itself with its browser contexts, `runResolution`, the dedupe set-aside, the `leavingRow` retrofit, the save warning, Dribbble self-resolving, and the trace vocabulary.
6. **`architecture.md:110` and the phase 5 and 6 specs still encode the old `abandoned` meaning.** That stays correct until task 15 lands, which supersedes those specs' criteria; phase 7's close updates the architecture doc.
