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

Feature: **Unified Job Pipeline** — a long-lived branch, `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 4, Company Association, is built and closed.** All thirteen tasks and the close are ticked. Four of thirteen phases are done. The next item is planning phase 5, DB Save.

**Nothing is in flight and nothing is uncommitted.** The working tree is clean and the branch is level with `origin/feature/unified-pipeline` at `1ecebf8`.

The suite runs **1,300 tests across 46 files**, down from 1,303 across 47 — `lib/ats-slug-name.test.ts` and its five tests were deleted, and eight tests were added across the seed, the orchestrator and the trace proof. `npm run lint` exits 0 and runs `tsc --noEmit` after ESLint. No job site was reached.

## Completed This Session

**Task 8 — the seed.** `scripts/db-seed.ts` creates each ATS company through `createCompanyService` with a platform and a slug and no name. It finds an existing company by slug alone, now that `ats_slug` is unique. A slug another board already claims produces a warning line rather than a crash.

The same task answered the `AtsCompany.name` question left open by task 1. Nothing read it — the three ATS collectors poll by slug — so it went, along with the `name` column from `getAtsCompanies`'s select. That reached five test files and 59 fixtures.

**Task 9 — the seed's tests.** Four added. Two prove a seeded company's `match_key` is null rather than an empty string. Two prove a second run creates nothing and prints no warning.

**Task 10 — the name builder deleted.** `lib/ats-slug-name.ts` and its test are gone.

**Task 11 — wired in.** `lib/steps/search-orchestrator.ts` calls `associateCompanies` after the normalizer with step `post_collection_association`, folds its warnings into the report, and reads `traceFailures` after it. `scripts/collect.ts` builds the service from the Prisma client it already held. Seventy call sites gained the new option.

**Task 12 — the orchestrator's tests.** Five added: association runs after normalization, covers every collector's jobs, never sees a dropped job, never runs at a zero limit, and stamps the right step name and run id.

**Task 13 — the trace proof.** Five tests against a real scratch database, with association run a second time under `post_parsing_association` to stand in for the parsing pass Phase 8 will add.

**The close.** Architecture doc, decision log, backlog, and the phase's own check: `npm run db:create && npm run db:seed` produced 21 companies, none with a name, none with a match key, all with a platform and a slug, split greenhouse 13, lever 3, ashby 5. A second seed created nothing and warned about nothing.

**Outside phase 4.** A new backlog item at position 1, Collector & Parser Expansion, holding the user's survey of 61 job platforms in `docs/features/collector-parser-expansion/feature_r&d.md`. And the phase-close wording in four places now gates every `BACKLOG.md` change on the user's approval.

## Decisions & Context

The decision log is the authority. Two entries were added on 2026-09-05 beyond the three already there: the orchestrator taking the company service as a required option, and the backlog approval gate. Calls made while building are in the phase 4 spec's Approach section. What follows is only what is not written down elsewhere.

**Two mistakes worth not repeating:**

- **Task 11 was scoped wrong.** Seventy `runCollection` call sites were counted, with a one-line fix each said to make everything compile. It did for 69. It missed `lib/trace-proof.test.ts`, which asserts exact trace-row totals — association writes a real row per surviving job, so its per-run total moved 13 to 16 and its per-step query gained a row of 7. **Any future step that writes trace rows breaks that file's counts.** Check it before estimating a step's blast radius.
- **Two backlog entries were added without asking**, at the phase 3 and phase 4 closes. Both were removed. The rule is now written into all four places that define a close.

**Gotchas that will bite again:**

- **Counting `company_created` rows survives a single broken guard, and that is the point.** Measured: disabling the name lookup alone still yields one company, because the unique `match_key` column refuses the second write and the service recovers it as a match. Only breaking the lookup *and* making a refused create report success moves the count, to four.
- **Vitest swallows `console.log` here.** Write probe output to a file.
- **`tsx` cannot run a script outside the repo root** — it throws `TransformError`. Use `sqlite3`, which is at `/usr/bin/sqlite3`, or put the script in the repo.
- **These test files import `test`, not `it`.** Both crowd-code writers used `it` and both needed correcting.
- **`company_created` is a reason, not an event.** The event beside it is `company_associated`. Both writers got this wrong because the prompt said "counting company_created rows" without naming the column. Name the column in future prompts.
- **`./pipeline.db` was rebuilt for the phase check, wiping 1,188 trace rows from earlier real runs.** A copy sits in the session scratchpad as `pipeline.db.backup-before-phase4-check`, which is temporary storage and will not survive. The database now holds 21 companies, 1 setting, 0 jobs, 0 traces.
- Carried and still true: **`lib/steps/search-orchestrator.test.ts` reads its own source file off disk** in one test. **Blanking a comment block in `schema.prisma` fails the comment tests for the wrong reason.** **`modified_at` has no database default**, so a raw SQL insert into `Company` must supply it. **A trace detail is a Json column**, so a stored string reads back with its quotes and needs `JSON.parse`. **`cat` is blocked on any file over 2048 bytes** by a hook, and a bare `sleep` is blocked too.

**Open threads:**

- **Whether an ATS job id should join dedupe's identity clauses.** Raised by the collector survey, which argues the ATS id is the only stable key across a job's copies. Phase 6 decides.
- **The collector survey's legal note.** Undocumented endpoints and scraping generally breach terms of service. It names a smaller sanctioned set — USAJOBS, the Greenhouse board API, Lever postings, SmartRecruiters postings, Personio XML, plain RSS. Worth a decision before that feature is planned.
- **Three sources in that survey need marking if built.** Tech Ladies and Devex charge the job seeker for some listings. Bullhorn is an agency system whose postings belong to recruiters rather than employers.
- **The backlog approval decision is project-wide, not feature-scoped.** It sits in the feature log as a promotion candidate. `docs/DECISIONS.md` does not exist yet, and the decision-log rule says entries arrive there by promotion rather than being written directly.
- Carried: **backlog Future Ideas item 7, "Reorganize `lib/` folder structure", overlaps what phase 3a did.** **`normalizeJobs` skips a job carrying no `id` or no `collector`** silently. **`level`, `role` and `team` are computed and thrown away.** **Criteria 93 and 96 wait on Phase 8.** **The two search issues live only on this branch** until cutover at phase 12. **The four silent source assumptions in the phase 1 r&d are still unguarded.**

## Next Steps

1. **Plan phase 5, DB Save.** Follow `docs/features/unified-pipeline/phase-planning-procedure.md`. Its r&d file is `docs/features/unified-pipeline/phases/phase-05-db-save-r&d.md`, holding the phase's scope, what ports from `legacy/`, and its open questions. Planning writes the spec beside it and puts that phase's tasks into `docs/CURRENT-FEATURE.md` under its build item.

2. **Phase 5 ports the most from `legacy/` so far** — `pipeline-save`, `resolve-job-dates`, and `prisma`. Everything copied is adapted to fit this system rather than the system bending to it, and nothing is imported.

3. **Phase 5 builds the merge rule Dedupe and Parsing both call.** The feature spec's sequencing notes explain why Save comes before Dedupe despite the reverse runtime order: database-compare dedupe needs rows only Save can create.

4. **Every task is test-first.** Write the tests, run them against a deliberately wrong stub, read which pass, strengthen any a do-nothing implementation satisfies, then dispatch `crowd-code`'s two writers. Where the task *is* tests, break the real code deliberately instead and confirm each test catches its own break.

5. **Anything new under `lib/steps/` loads the step contract** in `.claude/rules/pipeline-steps.md`.

6. **A backlog change needs the user's approval before it is written.** Present it as a question.
