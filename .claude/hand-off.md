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

**Planning phase 8 — Parsers.** It is partly done and stops at a clean boundary.

Discovery is finished and the stress test is finished. Every decision either reached the decision log or the phase r&d file. What is missing is the phase spec, which has never been written.

**Thirty-six acceptance criteria were drafted in conversation and never reviewed.** They were not written to any file, so they are gone. They have to be drafted again from the stories and the settled decisions, both of which are on disk.

No code changed this session. The working tree is clean and the remote matches `b221bbf`.

Verified at session end: 1,932 tests pass across 80 files, and `npm run lint` exits 0.

## Completed This Session

**Phase 8 planning, up to the spec.**

The brain dump is captured verbatim. Discovery settled about twenty questions, including the two the r&d file had carried open since phase 5.

**A three-agent stress test.** Two code analysts and one UX reviewer ran against the eleven phase-8 stories. Their raw findings, with what survived and what did not, are in `docs/features/unified-pipeline/phases/phase-08-stress-test.md`.

**Two real defects were found in code that already exists**, both verified by running it rather than reading it. Both become acceptance criteria in phase 8.

**Phase 8a was created** — sorting `lib/` — and sits in `docs/CURRENT-FEATURE.md` between phase 8 and phase 9.

**The `build-requirements` skill gained a verification step**, now step 6 of its Phase 4. It lives at `~/.claude/skills/build-requirements/SKILL.md`, outside this repository, so it is not in this project's commits.

Two commits pushed: `c447cd6` and `b221bbf`.

## Decisions & Context

### What the user decided

Twenty entries dated 2026-09-12 are in `docs/features/unified-pipeline/decision-log.md`. The fuller reasoning behind each is in `docs/features/unified-pipeline/phases/phase-08-parsers-r&d.md`, under `Settled in planning` and `Settled during the stress test, 2026-09-12`.

The ones that shape the build most:

- Four parsers port — Greenhouse, Lever, Ashby, Dribbble. Adzuna's does not.
- All three failure kinds are traced, and only "no parser for the domain" sets the status `unparseable`.
- Parsing opens no browser. Ashby reads its API instead of driving Playwright.
- A resolved link finds its parser by **registrable domain**, not by exact host.
- `Trace` gains a column holding that registrable domain. `detail` keeps the full link.
- A description is read only inside a matched parser. A job no parser covered gains nothing.
- Inside one parser, the source's own published field beats anything read from prose.

### Two defects to fix, both verified by running the code

**`in-person` is dropped silently.** `readWorkModeFromText` returns the literal string `in-person` at `lib/work-mode.ts:53`. `normalizeModeList` recognises only `remote`, `hybrid`, `onsite` and `on-site` at `lib/work-mode-list.ts:14-19`. Both sides are `string[]`, so it compiles, the value is thrown away, and the trace says normalization failed rather than that it was handed an unknown word. Fix: add `in-person` to the recognised list.

**The salary reader's shape does not fit its field.** `readSalaryFromText` returns `salary_low` and `salary_high`; `raw_salary` holds `salary_min` and `salary_max`. TypeScript catches a direct assignment, so this is a gap in the plan rather than a shipping bug. The round trip is safe — with no unit set the normalizer reads whole currency units, and every period word the reader emits is one it already accepts.

### Findings raised and dismissed — do not re-raise these

Four stress-test findings did not survive checking. They are recorded with their reasons in `phase-08-stress-test.md` so the next stress test does not surface them again.

- **A disqualifying status overwriting an active job.** The mechanics are all real and the path is not reachable. A job takes `unparseable` and leaves the backlog in the same run that parsed it, so nothing about it changes between the post-resolution dedupe and the post-parsing dedupe. It cannot newly match a row it did not already match, and at the earlier pass it carried no status.
- **A company minted from an unparseable job's low-trust name.** Company association runs right after collection, long before parsing, so the row is created whatever parsing later does. The decision of 2026-09-03 already settled that JSearch's name is trusted like any other.
- **Resolution stopping on an ATS board listing page.** All 655 ATS links in `dev.db` were tested against the slug readers. Zero would fail.
- **Greenhouse's `embed/job_app` link shape.** It appears zero times in the data.

### Measured this session

- **22 distinct hosts** across every link in `dev.db`. Greenhouse serves from three of them, and the third, `job-boards.eu.greenhouse.io`, appears exactly once.
- **`meredith.wd5.myworkdayjobs.com` is real.** The per-employer subdomain case is not hypothetical, which is what decided the registrable-domain collapse.
- **Ashby's API carries no employer name.** Checked live against the `hinge-health` board: the response holds only `jobs` and `apiVersion`.
- **`fetchWithTimeout` sets no headers at all**, while `lib/collectors/fetch-page.ts` spoofs a Chrome user agent on purpose.
- **The board-title reader was run against real title shapes.** A dangling dash cleans itself up later; `Careers - Acme` and `Page Not Found` both pass through as company names.

### Calls made, not user decisions

- The `build-requirements` skill was edited directly rather than through `writing-skills`, because it was a single-step insertion.
- The second stress-test round was skipped. The skill calls for it on an `XL` feature; the user chose to go straight to acceptance criteria.

### Open questions

1. **`.claude/CLAUDE.md.bak` and `.claude/session-status.md` are tracked and pushed.** A `git add -A` swept them in. Unanswered for nine sessions.
2. **The over-merge query that backlog entry 26 owes has not been run.** Its trigger, the first real run, has happened. The query is resolved links shared across distinct job ids, sliced by the rule that accepted them.
3. **Two jobs stopped on their own aggregator and saved as resolved.** Recorded as a seventh weakness in the resolver-refinements r&d. Phase 8 now handles the consequence — such a job goes `unparseable` — but whether resolution should stop doing it is undecided.

## Next Steps

1. **Redraft the acceptance criteria for phase 8.** Work from the eleven stories, which are in this session's transcript only, and from the settled decisions in the phase r&d file. The stories cover parsing a job, failing to parse, and knowing what parser to build next. Roughly 36 criteria, Given/When/Then, covering: matching a link to a parser by registrable domain, no browser, the shared field mapper, the board-page name read, the published-field-beats-prose rule, the three failure kinds and which one sets a status, the trace rows and the new domain column, and the summary's Parsing block.
2. **Write `phase-08-parsers-spec.md`** beside the r&d file — What We're Building, User Stories, Edge Cases, Acceptance Criteria, Tasks, Approach. A task is one unit of code together with its tests, never split in two.
3. **Run `spec-review` on it.**
4. **Check off "Plan phase 8"** in `docs/CURRENT-FEATURE.md` and put the task list under its build item.
5. **Invoke `wrap-up-planning`**, scoped to phase 8.
6. **Then build**, test-first, through the `start-work-session` loop.

### Facts the build will need

- **`tldts` is not installed yet.** It has to be added before the registrable-domain util can be written.
- **The command is `npm run job-search`.** `npm run collect` is gone.
- **The new pipeline uses `pipeline.db`.** `dev.db` is `main`'s live database and this branch never touches it, though it is the source for measurements and fixtures.
- **A database can drift from the schema with nothing warning.** `npx prisma db push` adds a missing nullable column and keeps the rows; `npm run db:create` destroys them.
- **Harvest the host fixture from `dev.db`, do not read it live.** It is untracked and keeps growing. This follows the precedent set for the search-term analyzer on 2026-08-27.
