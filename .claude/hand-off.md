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

**Phase 8 — Parsers. Planning is complete and the build has not started.**

The spec is at `docs/features/unified-pipeline/phases/phase-08-parsers-spec.md`: 16 user stories, 19 edge cases, 53 acceptance criteria, 22 tasks. `spec-review` ran twice and the user called it done rather than run a third round.

No code changed this session. The working tree is clean and the remote matches `443af8b`.

Verified at session end: 1,932 tests pass across 80 files, and `npm run lint` exits 0.

**The next unbuilt thing is task 1** — add `tldts` and write `lib/registrable-domain.ts`.

## Completed This Session

**The phase 8 spec, written and reviewed.**

The 36 criteria the last session drafted went through five passes. The user rejected the first two and the result is 53.

**Two grading rounds by sub-agent**, roughly twelve and twenty-five minutes. Round one found eight criteria asserting two things, one ambiguous criterion, six coverage gaps, an unresolved decision sitting in the spec, and a broken link. Round two found three user stories stating a mechanism rather than a goal, and that nothing said which five domains print.

**Five decision entries logged.** Three are criteria conventions that outlive this phase.

**An alignment check found two real contradictions**, both fixed. The feature spec's phases table said phase 8 ports every legacy parser while its own prose said four. The phase 8 r&d file counted Greenhouse's hosts as two in one note and three in another.

Three commits pushed: `7a08165`, `f03d5e6`, `443af8b`.

## Decisions & Context

### What the user decided

Five entries dated 2026-09-12 are at the bottom of `docs/features/unified-pipeline/decision-log.md`, after the entry about sorting `lib/`. Twenty earlier entries from the same date belong to the discovery session.

Three are conventions for every phase from here:

- **A criterion states the general rule, not one example of it.** A criterion naming a single case leaves every other case undefined.
- **A criterion carries no explanatory note beside it.** A note adds requirements the criterion itself does not state.
- **A criterion may name a status, a database column, a trace event or a command.** The spec rubric is what gets refined, not the criteria.

Two are phase 8's:

- **The run summary prints the five domains with the most failures and no line counting the rest.** The failed total already prints above the list.
- **A domain that failed once is listed like any other.** Nothing in the summary recommends building a parser, so the list is information rather than a suggestion.

### Calls made, not user decisions

The user was told about these and chose not to review them.

- **The 22 build tasks and their order are Claude's.** The user scrutinised the criteria across five passes and never looked at the task list, which now drives the build order in `CURRENT-FEATURE.md`.
- **The 16 user stories are Claude's.** Eleven were reconstructed from the earlier discovery session, which recorded its decisions but never wrote its stories down.
- **The feature spec's parsing stories were edited** — the failure story split in two to match the three-way split, and the tool category added to the architectural constraints, where it had been missing since phase 7a.

### Gotchas discovered

- **The rubric applies its no-implementation-detail check only to acceptance criteria.** Everywhere else in a spec names files and functions freely.
- **That check has no stated boundary, and the grader gave three different answers to it inside one document.** It flagged a function name correctly, flagged a plain-words phrase naming no code, and passed database columns by citing phase 7 as precedent.
- **`spec-review`'s loop re-grades in full after any fix.** Its Phase 2 returns to Phase 1 whenever a correction touches stories, edge cases, criteria or tasks, which every meaningful fix does.
- **`phase-planning-procedure.md` changed mid-session**, by the user. The spec is now assembled as a draft, reviewed, then written once on approval. This session wrote it to disk first and reviewed it there.

### Approaches abandoned

- **Rewriting roughly 30 criteria to strip status and column names.** The user's stated intent supports it, but the criteria predate the rubric and phases 1 through 7 name the same things. The rubric changes instead.
- **A third grading round.** The user stopped it: the criteria were not written against the rubric, so further rounds would be rough.
- **Filing three backlog items.** The user told me to toss them. They are recorded in the meeting notes as raised and dropped: `spec-review`'s cost, the rubric's undrawn boundary, and a phase planned across two sessions getting notes for one.

### Open questions

1. **Where the line falls between a criterion and a requirement.** The user will refine the spec rubric. Until then, roughly 30 of phase 8's 53 criteria name a status, a column, an event word or a command.
2. **`.claude/CLAUDE.md.bak` and `.claude/session-status.md` are tracked and pushed.** A `git add -A` swept them in. Unanswered for ten sessions.
3. **The over-merge query backlog entry 26 owes has not been run.** Its trigger, the first real run, has happened. The query is resolved links shared across distinct job ids, sliced by the rule that accepted them.
4. **Whether resolution should stop on its own aggregator.** Two jobs did and saved as resolved. Phase 8 handles the consequence — such a job goes `unparseable` — but the resolver behaviour is undecided.

### Do not re-raise

The four stress-test findings on the previous hand-off's do-not-re-raise list remain dismissed. Three now sit in the spec's **Behaviour not covered by a criterion** section so a future grader stops finding them: the three board-title shapes that read as a name, company association minting a row from a job that later goes `unparseable`, and the two accepted weaknesses.

## Next Steps

1. **Build task 1** — add `tldts` as a dependency and write `lib/registrable-domain.ts`, exposing `registrableDomainFromUrl(url)` that returns null for anything that is not a web address and for an address with no owned domain. Test first, through `crowd-code`.
2. **Then tasks 2 and 3**, the two verified defects. Widen `normalizeModeList` to recognise `in-person`, tested by running every value `readWorkModeFromText` can return through it. Then write `rawSalaryFromText`, turning the description reader's `salary_low`/`salary_high` into the envelope's `salary_min`/`salary_max`.
3. **Then task 4**, splitting the fetching half out of `fetchContainer` into `lib/tools/page-fetcher.ts` with the browser user agent.
4. **Then tasks 5 to 22 in order.** The order is deliberate: shared pieces before parsers, the registry after the four parsers, the handler after the registry, the orchestrator after the handler, and the summary last because it reads the rows the handler writes.
5. **Close phase 8** — architecture doc, decision log, and any `BACKLOG.md` change presented for approval.

### Facts the build will need

- **`tldts` is not installed yet.** Task 1 adds it.
- **The command is `npm run job-search`.**
- **The new pipeline uses `pipeline.db`.** `dev.db` is `main`'s live database and this branch never touches it, though it is the source for measurements and fixtures.
- **A database can drift from the schema with nothing warning.** `npx prisma db push` adds a missing nullable column and keeps the rows; `npm run db:create` destroys them. After editing `prisma/schema.prisma`, run `npx prisma generate`.
- **Harvest the host fixture from `dev.db`, do not read it live.** It is untracked and keeps growing.
- **Ashby's API carries no employer name.** Verified live against the `hinge-health` board: the response holds only `jobs` and `apiVersion`.
- **`fetchWithTimeout` sets no headers at all**, while `lib/collectors/fetch-page.ts` spoofs a Chrome user agent on purpose.
