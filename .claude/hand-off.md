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

**Thirty-six acceptance criteria were drafted and never reviewed.** They are written out below, under *Acceptance criteria drafted, not reviewed*. They are a draft: the user has not agreed to them, and they go into the phase spec only after review.

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

### Acceptance criteria drafted, not reviewed

Drafted 2026-09-12 from the eleven phase-8 stories and the settled decisions. The user never reviewed them, so they are a starting point rather than an agreed list. Numbering is this phase's own.

**Matching a job to a parser**

1. Given a resolved link whose registrable domain is `greenhouse.io`, When parsing runs, Then the Greenhouse parser reads it.
2. Given a resolved link whose registrable domain is `lever.co`, `ashbyhq.com` or `dribbble.com`, When parsing runs, Then that source's own parser reads it.
3. Given the committed fixture of every distinct resolved-link host in `dev.db`, When each is matched, Then all three Greenhouse hosts reach the Greenhouse parser and no host reaches a parser that does not serve it.
4. Given a resolved link on `adzuna.com`, When parsing runs, Then no parser reads it.
5. Given a resolved link that does not parse as a URL, When parsing runs, Then the job takes `unparseable` and the handler does not throw.

**Reading a job**

6. Given any parser reading its source, When it runs, Then it opens no browser.
7. Given a parser fetching a web page, When the request is sent, Then it carries a browser user agent.
8. Given a Greenhouse, Lever or Ashby response, When the collector and the parser each map it, Then both call one shared mapper.
9. Given that shared mapper, When it returns, Then it carries no link and no phase gate.
10. Given a Lever or Ashby job carrying a slug and no employer name, When the parser runs, Then it reads the name from the board page title.
11. Given a board page that answers with an error status, When the parser runs, Then no employer name is written.
12. Given an Ashby job, When the parser finds its posting in the board response, Then it matches on the link match key rather than exact text.
13. Given a Dribbble job, When the parser runs, Then it writes `description`.

**Reading a description**

14. Given a posting whose source published a salary field, When the parser runs, Then the description is not read for a salary.
15. Given a posting with no salary field whose description states pay, When the parser runs, Then `raw_salary` carries those figures as `salary_min` and `salary_max`.
16. Given a posting whose source published a work mode field, When the parser runs, Then the description is not read for a work mode, and where that field is absent the description fills it.
17. Given a description read as `in-person`, When normalization runs again, Then the job's normalized mode list holds `in-person`.
18. Given a job no parser covered, When parsing runs, Then no salary and no work mode are read from its description.

**Failing to parse**

19. Given a job whose registrable domain no parser covers, When parsing runs, Then it takes `unparseable` and its parsed flag stays false.
20. Given a parser that threw or whose source refused the request, When parsing runs, Then the job keeps `backlog` and its parsed flag stays false.
21. Given a parser that returned no fields at all, When parsing runs, Then the job keeps `backlog` and its parsed flag stays false.
22. Given a parser that returned at least one field, When parsing runs, Then the parsed flag is true.
23. Given a job that took `unparseable` on an earlier run, When a later run gathers the parsing list, Then that job is not on it.
24. Given a job that kept `backlog` after failing to parse, When a later run gathers the parsing list, Then that job is on it.
25. Given one job whose parse throws, When parsing runs over the list, Then every other job on the list is still parsed.

**Tracing**

26. Given a job a parser read, When parsing runs, Then a `job_parsed` row is written.
27. Given the three failure kinds, When each happens, Then a `parse_failed` row carries `no_parser_for_domain`, `parser_errored` or `nothing_parsed`.
28. Given any `parse_failed` row, When it is written, Then it carries the registrable domain in its own column and the full resolved link in `detail`.
29. Given a resolved link yielding no registrable domain, When the row is written, Then that column is empty and nothing throws.

**The run summary**

30. Given a finished run, When the summary prints, Then it names how many jobs parsed, zero included.
31. Given a run where jobs failed to parse, When the summary prints, Then it names how many, and lists at most five domains with a count each.
32. Given a listed domain, When it prints, Then it carries either `no parser` or `parser failed`.
33. Given two domains with equal counts, When the list prints, Then they order alphabetically.
34. Given a run where every job parsed, When the summary prints, Then no domain list prints.

**The rest of the step**

35. Given the parsed list, When the step continues, Then it runs normalization, association, dedupe and save in that order.
36. Given the four parsers, When `npm run db:seed` runs, Then each has a priority list entry above every collector and below `collector:user`.

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

1. **Put the drafted acceptance criteria below to the user for review.** They are written out in this document and need no redrafting. Ask what is missing and what they disagree with, then revise.
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
