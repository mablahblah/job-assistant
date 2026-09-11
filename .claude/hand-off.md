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

**Phase 7, URL Resolution, is planned and not started.** Its spec is written and approved at [`phases/phase-07-url-resolution-spec.md`](../docs/features/unified-pipeline/phases/phase-07-url-resolution-spec.md) — 81 acceptance criteria and 18 tasks, with the regression net named. Six of fourteen phases are closed.

**1,730 tests across 64 files pass, `npm run lint` exits 0**, both verified fresh at close. This session wrote no application code.

**Nothing is committed.** HEAD is still `1193804`.

| File | What changed |
| --- | --- |
| `phases/phase-07-url-resolution-spec.md` | New — the phase spec |
| `phases/phase-07-url-resolution-r&d.md` | Settled decisions, two measurements, backlogged items, two open questions |
| `meeting-notes/2026-09-11-phase-07-url-resolution-meeting-notes.md` | New |
| `decision-log.md` | 24 entries added, 4 superseded |
| `feature_spec.md` | Vocabulary, resolver rubric, dedupe tracking stories, phase table, sequencing note, two new blacklist stories, one story deleted and one reworded |
| `docs/CURRENT-FEATURE.md` | Plan phase 7 checked, 18 build tasks listed |
| `docs/BACKLOG.md` | Resolution Accuracy retired, entries renumbered, Resolver Refinements added at 26 |
| `docs/research/resolution-accuracy.md` | Moved out of `features/`, six inbound links repointed |
| `features/resolver-refinements/` | New |
| `features/update-job-workflow/feature_r&d.md` | Enriched — the orchestrator left the pipeline feature |

**Modified by the previous session, not this one:** `lib/job-list-entry.ts`, `lib/job-service.test.ts`, `prisma/schema.test.ts`.

## Completed This Session

Phase 7 planning, end to end — discovery, stories, two stress-test rounds, acceptance criteria, spec review, tracking, and wrap-up.

- **Four discovery questions closed**, including the `abandoned` one that blocked the phase.
- **Two live measurements**, recorded with their limits in the r&d.
- **Six sub-agents** across two stress-test rounds. Two findings were verified by hand against shipped code and changed the phase's scope.
- **Backlog changes approved and written** — Resolution Accuracy retired into phase 7, Resolver Refinements added.

## Decisions & Context

**Every decision is in the decision log** — 24 entries dated 2026-09-11. Read those rather than re-deriving them. What follows is only what lives nowhere else.

### Two sub-agent claims were wrong, and both would have cost work

One proposed the `abandoned` retrofit emit both events from dedupe, which would have written `job_dbrow_deleted` twice for every merged-away row — save already writes it at `lib/steps/save.ts:78`. The same agent flagged dedupe's pass-one loop as needing the same fix; it doesn't, for the same reason. **Verify a sub-agent's claim against the code before acting on it.**

### The measurement instrument matters more than the number

The first same-domain-hop run measured "did the description survive the hop", which is not the question that was asked. The second measured "is the previous URL a job posting", using the structured data boards publish for Google Jobs. Greenhouse publishes none, and Ashby and Workday return empty bodies to a plain fetch — so half that run measured which boards opt into structured data rather than anything about resolution, and was discarded rather than reported.

### Gotchas found this session

- **A scratchpad script can reach `node_modules` by symlinking it in.** This supersedes the previous hand-off's claim that it cannot. Both measurements ran that way, with no spike code in the repo.
- **`check-links.py` does not decode `%26`**, so it flags 25 working `feature_r&d.md` links. There are 17 genuinely broken links, all pre-existing, mostly `docs/APP.md`.
- **Most URLs in `dev.db` are dead** — roughly a third of the Adzuna sample 404s or 410s, and 13 of 40 Lever postings had expired. Sample well above the target count.
- **Playwright 1.58 is installed**, and a headed run opens windows that take focus.
- **`spec-review` expects the draft not to be on disk** until approved. It was written first this session.

### Approaches tried and abandoned

- **Porting the spike's Adzuna fix** — a domain-specific `if` beside the dead weLoveProduct one. Rejected against the architecture; the three general rules replace both.
- **Following a same-domain link only while on the starting domain** — the user called it an overfit before any of it was built.
- **A circuit breaker for a refusing host** — designed in full, then dropped as unmeasured. It is backlog entry 26's sixth item.
- **Capturing Ashby and Workday postings as fixtures** — proposed and withdrawn; a client-hydrated page does not replay from saved HTML. The hop loop is tested against a fake `Page` instead.

### Not preserved

Both experiment harnesses lived in the session scratchpad and are gone. Their results are in the r&d. `same-domain-hop.mjs` is the one worth rebuilding if Resolver Refinements is ever picked up.

### Carried forward, still true

`cat` is blocked over 2048 bytes — use `sed -n` or Read. `grep -r --include` needs the pattern quoted. `timeout` is not on PATH. Vitest swallows `console.log` and its output carries ANSI codes. `PIPESTATUS` does not survive. `npm run lint` runs ESLint then `tsc --noEmit`. `dev.db` at the repo root is the legacy database; `pipeline.db` is the new one. After editing `prisma/schema.prisma` run `npx prisma format`, `npx prisma generate`, then `db:create` and `db:seed`. Anything new under `lib/steps/` loads `pipeline-steps.md` and `naming.md`. Rule edits go through `writing-rules`, skill edits through `writing-skills`. A `docs/BACKLOG.md` change needs approval first. Questions are plain text. Every message over one paragraph ends with a TL;DR.

## Next Steps

1. **Build phase 7, task 1** — port the blacklist into `lib/blacklist.ts` with its tests. Source is `legacy/lib/blacklist.ts`, ported unchanged; criteria 12 to 15 cover it.
2. **Then tasks 2 to 4**, the other unchanged ports — domain utilities, dead-end signals, the apply-link pattern.
3. **Task 5 before tasks 6 to 8.** The fake `Page` has to exist before the hop loop can be tested, and nothing in this codebase fakes one today.
4. **Two open questions are answered during the build, not before it:** how strong the settle condition has to be, and how common an apply button whose wording misses `APPLY_LINK_PATTERNS` really is. Both are in the r&d with the evidence each needs.
5. **`pipeline.db` still holds 20 jobs, 31 companies, 296 trace rows** and was never reset. Eleven of the 20 are unresolved and the user wanted them in a bigger resolver test set.
6. **`architecture.md:110` and the phase 5 and 6 specs still encode the old `abandoned` meaning.** That is correct today and becomes wrong when task 15 lands — task 15 supersedes the phase specs' criteria, and phase 7's close updates the architecture doc.
