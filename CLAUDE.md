# Job Search Assistant

A CLI Tool - via Claude Code skills - to automate job searching, prioritizing, tracking job applications, and managing an unemployment ‘Work Log.’

## Tech Stack

- **Runtime:** TypeScript via tsx (no build step), Node.js
- **Database:** SQLite via Prisma ORM (libsql adapter)
- **Browser Automation:** Playwright (collector scrapers)
- **HTML Reading:** linkedom — turns an HTML string into a queryable document in plain Node, so page-reading code runs without a browser and is testable offline
- **Dashboard:** Server-rendered HTML, vanilla CSS/JS
- **Testing:** Vitest
- **Linting:** ESLint with @typescript-eslint
- **Workflows:** Claude Code skills orchestrating CLI subcommands

## Branch: unified pipeline rebuild

**The old pipeline is gone.** `legacy/` was deleted at the switch over, with everything worth keeping copied out beforehand rather than imported.

Real job searches now run on this branch, against `pipeline.db`. Both database files are untracked and survive branch switches. `dev.db` at the repo root is the old one, kept as the migration's source and read by nothing.

## Commands

```bash
npm run job-search                        # Run the whole pipeline; prints its run identifier first
npm run score:gather -- --out FILE        # Write out every job and company still needing a score
npm run score:save -- --in FILE           # Write the scores an agent worked out back to the database
npm run find-jobs -- --url U --company X  # Find a job by its link, else by part of its employer's name; prints data
npm run change-status -- --in FILE        # Set a job's status by hand; files a work log entry where Texas counts it
npm run add-external-jobs -- --in FILE    # Add jobs found outside a search, from their links, and run them through the pipeline
npm run recover-unparseable-jobs          # Run once after a new parser ships; returns unparseable jobs to the backlog
npm run fetch-rendered-page -- --url URL  # Print a page's finished HTML, after its scripts have run
npm run serve                             # Start the dashboard from scripts/serve.ts
npm run db:migrate  # Change the schema, keeping every row; writes a dated backup first
npm run db:create FILE   # Rebuild a named database from the schema; refuses the real one
npm run db:seed     # Fill absent settings and the source priority list, overwriting nothing
npm run lint        # ESLint, then the type check — docs/ is ignored
npm run test        # Vitest — docs/ is excluded
```

**`db:migrate` is the only way to change the schema.** `db:create` deletes its target and rebuilds it, so it takes an explicit file argument and refuses the database `PIPELINE_DATABASE_URL` names in `.env`.

**After editing `prisma/schema.prisma`, run `npx prisma generate`.** Neither database command regenerates the client, so it otherwise goes on describing the old schema. A fresh clone is covered by `postinstall`, which generates on install.

## Architecture

One pipeline whose only differentiated code is collectors and parsers. Every deterministic step, from backlog cleanup through classification, is built and runs end to end from `npm run job-search`. Scoring is built too, and the `job-search` skill runs it straight after the pipeline, through two commands of its own — an agent does the judging, and no single command can pause while it thinks. The work log is built as well, but no job search reaches it: it runs when the user changes a job's status by hand, through `npm run change-status`. Every step ends in a database write, so no step depends on another holding a list in memory.

**[`architecture.md`](docs/architecture.md) describes the system as built — read it before changing code.**

Every file in `lib/` sits in a folder named for the kind of thing it is, and `lib/` holds no file of its own. The map is in [`.claude/rules/naming.md`](.claude/rules/naming.md).

| Folder               | Holds                                                           |
| -------------------- | --------------------------------------------------------------- |
| `lib/collectors/`    | The code that pulls a raw job list from one source              |
| `lib/db/`            | The database connection, its environment, the schema check, and the settings row's starting values |
| `lib/handlers/`      | The code that runs at one pipeline position                     |
| `lib/orchestrators/` | The runner that calls every handler in order                    |
| `lib/parsers/`       | The code that reads one source's job posting                    |
| `lib/resolvers/`     | The code that follows a job link toward its source posting      |
| `lib/services/`      | The code that owns one table or one row                         |
| `lib/tools/`         | Wrappers around something outside the app, and their interfaces |
| `lib/types/`         | Shapes shared across folders, holding no logic                  |
| `lib/utils/`         | Plain functions taking values and returning values              |
| `lib/views/`         | The code that turns data into a screen                          |

Planning lives in [`docs/features/_complete/unified-pipeline/`](docs/features/_complete/unified-pipeline/):

| File              | What it is                                                        |
| ----------------- | ----------------------------------------------------------------- |
| `decision-log.md` | Signed-off decisions                                              |
| `feature_spec.md` | What is being built, the phases, the working flow                 |
| `phases/`         | An r&d file per phase, and a spec once the phase is planned       |
| `feature_r&d.md`  | Brain dump, measured database facts, title-normalization research |
| `db-entries.md`   | Field-by-field shape of the current Job and Company records       |

Path-scoped rules describing the old architecture were deleted with it. The rules that govern this pipeline sit in `.claude/rules/`:

| Rule                  | Answers                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `part-ownership.md`   | Where new behaviour goes, and what each kind of part may never do               |
| `naming.md`           | What any file, test or value is called, and which folder it sits in             |
| `handler-contract.md` | What the code that runs at one pipeline position must look like and be called   |
| `tools.md`            | What a wrapper around something outside the app looks like                      |
| `services.md`         | What the code that owns one table looks like                                    |
| `sources.md`          | What a collector or parser is called, and how it joins the pipeline             |
| `orchestrators.md`    | What a runner of the pipeline is called                                         |
| `resolvers.md`        | What the code that follows job links looks like                                 |
| `types.md`            | What a shared shape file holds                                                  |
| `utils.md`            | What a plain function is called, and where it lives                             |
| `views.md`            | What the code that builds a screen looks like                                   |
| `source-registry.md`  | What has to happen when a collector or parser is added or renamed               |
| `run-summary.md`      | What a command prints when it finishes                                          |

## Terminology

- **Collector:** Pulls raw job list from Aggregators and ATS Systems
- **Orchestrator:** Runs the pipeline, calls the right handlers, scoring, etc in the proper order.
- **Dedupe:** Removes duplicate jobs at three points in a run: after collection, after resolution, and after parsing. Two jobs match on the same original link, the same resolved link, or the same employer and title posted within 30 days. When two copies merge, the source priority list, which ranks every collector and parser, decides which copy of each field survives.
- **Resolver/Resolution:** Following job posting links and redirects, especially from aggregators, in an attempt to find the source posting with the most accurate information.
- **Parser:** Tool that takes the best job posting url and extracts key information.
- **Service:** A reusable piece built from the database connection. It is handed that connection and hands back a small object holding a few functions, owning one table or one row — `createSettingsService(db)`, `createTraceService(db)`. Never called a store, a repository, or a DAO, whatever the function it returns is named.
- **Util:** A plain function taking values and returning values, reaching no database — `companyMatchKey(name)`, `normalizeCompanyName(raw)`.
- **User:** Me, the person who built this app.
- **Web View**: A simple, semi-static web representation of our data

## Working Agreements

**Build broadly, not for the case in front of you.** A rule that exists only to make one observed example come out right is a defect. Break it into a general step that already exists.

**No guardrail for a failure nobody has seen.** A measured occurrence is what justifies building against it. Until then the risk is written down, not coded around.

**An exception is a closed list, never a judgement.** Where a rule allows an exception, it names the exact files or cases. An exception left to be judged is one that gets taken every time.

**Knowledge about a job site is data, never code.** A rule may read a list of websites. A rule may not contain one. Source-specific judgement lives in collectors and parsers and nowhere else.

<!-- code-review-graph MCP tools -->

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore the codebase.** The graph is faster, cheaper (fewer tokens), and gives you structural context (callers, dependents, test coverage) that file scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool                        | Use when                                               |
| --------------------------- | ------------------------------------------------------ |
| `detect_changes`            | Reviewing code changes — gives risk-scored analysis    |
| `get_review_context`        | Need source snippets for review — token-efficient      |
| `get_impact_radius`         | Understanding blast radius of a change                 |
| `get_affected_flows`        | Finding which execution paths are impacted             |
| `query_graph`               | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes`     | Finding functions/classes by name or keyword           |
| `get_architecture_overview` | Understanding high-level codebase structure            |
| `refactor_tool`             | Planning renames, finding dead code                    |
