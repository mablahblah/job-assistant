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

**Phase 8 — Parsers. Tasks 1 to 18 of 22 are built. Tasks 19 to 22 remain, then "Close phase 8".**

The spec is at `docs/features/unified-pipeline/phases/phase-08-parsers-spec.md`.

Verified at session end: **2,171 tests pass across 95 files, and `npm run lint` exits 0.**

Seven commits pushed, `443af8b` to `72e7c8e`:

| Hash | Subject |
| --- | --- |
| `3405cb2` | docs: the hand-off the previous session wrote is committed |
| `ee7ccd8` | fix: the two defects phase 8 found by running the code |
| `9a7afc0` | feat: the two shared pieces every parser needs land first |
| `69aa917` | refactor: the three ATS field mappings are lifted out of their collectors |
| `3e31863` | feat: the four parsers and the registry that finds them |
| `1ea78c6` | feat: parsing becomes a step of the pipeline |
| `72e7c8e` | docs: phase 8's first eighteen tasks are marked built |

**Three files are modified and uncommitted**, all written after that last commit: `docs/CURRENT-FEATURE.md` (task 5's checkbox, ticked late — see the gotcha below), `docs/features/unified-pipeline/decision-log.md` (one new entry), and the phase 8 spec (a new *Calls the build made* section). Commit them before starting task 19.

**The next unbuilt thing is task 19** — the Parsing block in `lib/run-summary.ts`.

## Completed This Session

**Parsing became a real step of the pipeline.** A job search now reads its own list of resolved-but-unparsed jobs, reads each posting with the parser that owns its link's domain, then normalizes, associates, dedupes and saves.

**Tasks 1 to 4 — the defects and the shared pieces.**

- `tldts` added, and `lib/registrable-domain.ts` written: `registrableDomainFromUrl(url)` gives null for anything that is not an http or https address, and for an address with no owned domain.
- `normalizeModeList` widened to recognise `in-person`, which its sibling reader has always returned and it always dropped.
- `lib/raw-salary-from-text.ts` turns the description reader's `salary_low`/`salary_high` into the envelope's `salary_min`/`salary_max`, or null.
- `lib/tools/page-fetcher.ts` holds `fetchPageHtml(url)` and `BROWSER_USER_AGENT`; `fetchContainer` was repointed at it.

**Tasks 5 to 7 — the three field mappings lifted.** `lib/greenhouse-fields.ts`, `lib/lever-fields.ts` and `lib/ashby-fields.ts` each hold what was a private `toJobListEntry` inside a collector, minus the link and the phase gates. Every collector was repointed, and each collector's test now proves it went through the shared mapper rather than a copy, using a `vi.mock` spy that still runs the real function.

**Tasks 8 to 13 — the parsers.** `lib/parsers/types.ts` holds the `Parser` contract. The four parsers are `greenhouse.ts`, `lever.ts`, `ashby.ts` and `dribbble.ts`. `registry.ts` holds `PARSERS_BY_DOMAIN` and `parserForUrl`, checked against `resolved-addresses.fixture.json`.

**Tasks 14 to 18 — the step itself.** `findUnparsed()` on the job service and its fake. A `domain` column on `Trace`, carried by `TraceEvent` and grouped by `countsForRun`. `lib/handlers/parsing.ts` and its two test files. The step wired into `runJobSearch` behind a new `parserFor` option.

**Two files added beyond the 22 tasks**, both approved and recorded in the spec: `lib/description-fallback.ts` and the `MappedJobFields` type.

## Decisions & Context

### What the user decided

One entry, dated 2026-09-12, at the bottom of `docs/features/unified-pipeline/decision-log.md`:

- **The page-fetcher tool is a plain function, `fetchPageHtml(url)`**, not the `create{Subject}()` builder `.claude/rules/naming.md` prescribes for a tool. The builder shape exists so a test can be handed a stand-in; this fetcher holds no state to configure, and the tests needing one already swap the global `fetch`.

### Calls made, not user decisions

Seven, all shown to the user and approved as work-documentation. They are written into the phase 8 spec under **Calls the build made**. Read them there. Do not re-litigate them.

In short: two files added beyond the task list, three behaviour choices the spec left open (an unreadable link errors, a vanished Ashby posting reads as nothing found, parsing runs one job at a time), and two trace-shape choices (only failure rows carry the domain, and `detail` holds the link as plain text).

### Facts verified live on 2026-09-12 — do not re-check

- **Greenhouse's single-posting endpoint returns the same object shape as the board-list endpoint**, `first_published` and `company_name` included. Checked against `stripe`. The shared mapper takes it unchanged, and no second request is needed for the employer's name.
- **Lever's single-posting endpoint matches its list endpoint.** The `gohighlevel` board page's title is exactly `HighLevel` — the bare employer name.
- **Ashby's board answer holds only `jobs` and `apiVersion`.** The `hinge-health` board page's title is `Hinge Health Jobs`, which `nameFromBoardTitle` reduces to `Hinge Health`.
- **A Dribbble job page carries two data blocks**: an inline `Dribbble.JobListing.initialize({...})` with `locationType` and `trackingProperties`, and a JSON-LD `JobPosting`. Checked against `https://dribbble.com/jobs/310076-Senior-Creative-Designer`.
- **`dev.db` holds 2,208 jobs across 17 distinct link hosts.** The fixture is those 17, each naming the parser it must reach. It includes `job-boards.eu.greenhouse.io` at one job, and `historical`, a stored value that is not a web address at all.

### Gotchas discovered

- **A blocked Bash command runs none of its parts.** The read-guard hook rejects the whole command line, so a `sed` chained ahead of a blocked `cat` never runs. That is exactly how task 5's checkbox stayed unticked while the task was built and committed. Check the file after any chained edit.
- **After editing `prisma/schema.prisma`, run `npx prisma generate` and `npx prisma db push`.** Both were run for the `Trace.domain` column.
- **`TraceDetail` does not accept `{ url: string }`.** It accepts a bare string, `{from, to}`, and two dedupe-specific shapes. The parsing handler stores the resolved link as a plain string.
- **The parsing step changed what a whole-pipeline run writes.** A job resolved in a run is now parsed in the same run, so it is normalized twice. Two suites in `lib/trace-proof.test.ts` had to grow: three by-collector counts gained `AND step = 'post_collection_normalization'`, and two step-total lists gained the four parsing steps.
- **Two resolution tests are now handed `findUnparsed: async () => []`** through `resolutionStepOver` in `lib/orchestrators/job-search.test.ts`, because a row they mark resolved would otherwise join the parsing list.
- **A parsed field does not yet outrank a collected one.** `parser:greenhouse` is absent from the seeded priority list, so `sideRank` returns null for the parser side and a stored collector value wins a contested field. Task 20 fixes it. One orchestrator test therefore asserts on `raw_company_name`, a field the stored row leaves empty, rather than on `raw_title` — revisit that assertion once task 20 lands.

### Open questions

1. **`.claude/CLAUDE.md.bak` and `.claude/session-status.md` are tracked and pushed.** A `git add -A` swept them in. Unanswered for eleven sessions.
2. **The over-merge query backlog entry 26 owes has not been run.** Its trigger, the first real run, has happened. The query is resolved links shared across distinct job ids, sliced by the rule that accepted them.
3. **Whether resolution should stop on its own aggregator.** Two jobs did and saved as resolved. Phase 8 handles the consequence — such a job goes `unparseable` — but the resolver behaviour is undecided.

### Do not re-raise

The four stress-test findings on the previous hand-off's list remain dismissed, and three sit in the spec's **Behaviour not covered by a criterion** section. The spec's new **Calls the build made** section is settled too.

## Next Steps

1. **Commit the three modified docs** listed under Current Task before starting anything.
2. **Task 19 — the Parsing block in `lib/run-summary.ts`.** How many jobs parsed, how many did not, and the failing owned domains with a count each. Each listed domain carries `no parser` or `parser failed`. Highest count first, capped at five with no line counting the rest, ties broken alphabetically, this run's rows only. It reads the trace rows the handler already writes; `TraceRunCount` now carries `domain`.
3. **Task 20 — seed the four parsers** into `SOURCE_PRIORITY_DEFAULTS` in `scripts/db-seed.ts`, above every collector and below `collector:user`. `npm run db:seed` appends a new name to the bottom whatever its kind, so each has to be placed by hand. This is what finally makes a parsed field outrank a collected one.
4. **Task 21 — write parsing's vocabulary** into the `Trace` model comment in `prisma/schema.prisma`, into `trace-events.md`, and into `prisma/schema.test.ts`. The step names in use are `parsing`, `post_parsing_normalization`, `post_parsing_association`, `post_parsing_dedupe` and `post_parsing_save`. The events are `job_parsed` and `parse_failed`, with reasons `no_parser_for_domain`, `parser_errored` and `nothing_parsed`.
5. **Task 22 — add a Parsers section to `.claude/rules/naming.md`.** Ask the user about one thing while you are in that file: its Tools section says a tool has a `create{Subject}()` builder, and this session's page-fetcher deliberately does not. That exception may belong in the rule. The user decides whether to write it.
6. **Close phase 8** — architecture doc, decision log, and any `BACKLOG.md` change presented for approval.

### Facts the build will need

- **The command is `npm run job-search`.**
- **The new pipeline uses `pipeline.db`.** `dev.db` is `main`'s live database and this branch never touches it, though it is the source for measurements and fixtures.
- **The four parsers name themselves `greenhouse`, `lever`, `ashby` and `dribbble`**, matching their filenames. A registry test reads each file off disk by that name to prove no parser reaches for Playwright.
- **`parseJobs` takes an optional `parserFor`**, and so does `runJobSearch`. Left out, both use the real registry. It is how every parsing test stays offline.
