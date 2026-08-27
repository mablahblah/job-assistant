# Job Search Assistant

A CLI Tool - via Claude Code skills - to automate job searching, prioritizing, tracking job applications, and managing an unemployment ‘Work Log.’

## Tech Stack

- **Runtime:** TypeScript via tsx (no build step), Node.js
- **Database:** SQLite via Prisma ORM (libsql adapter)
- **Browser Automation:** Playwright (collector scrapers)
- **Dashboard:** Server-rendered HTML, vanilla CSS/JS
- **Testing:** Vitest
- **Linting:** ESLint with @typescript-eslint
- **Workflows:** Claude Code skills orchestrating CLI subcommands

## Branch: unified pipeline rebuild

This branch rebuilds the pipeline from scratch. The old one is quarantined in [`legacy/`](legacy/README.md) and does not run here — it is reference material to copy from, never to import.

**No bleed-through.** New code imports nothing from `legacy/`. Anything worth keeping is copied out, so shipping means deleting that folder in one move.

Real job searches run on `main`, where the old pipeline is untouched. The database is untracked and survives branch switches; `dev.db` at the repo root is the live one.

## Commands

```bash
npm run db:create   # Delete the pipeline database and rebuild it from the schema
npm run db:seed     # Fill absent settings and ATS companies, overwriting nothing
npm run lint        # ESLint — legacy/ and docs/ are ignored
npm run test        # Vitest — legacy/ and docs/ are excluded
```

**After editing `prisma/schema.prisma`, run `npx prisma generate`.** `prisma db push` does not regenerate the client, so `db:create` alone leaves it describing the old schema. A fresh clone is covered by `postinstall`, which generates on install.

`npm run cli` and `npm run serve` reach into `legacy/` and are retired with it.

## Architecture

Nothing is built yet. The target shape is a single pipeline whose only differentiated code is collectors and parsers, running four phases — Collection, Resolution, Parsing, Classification — each ending in a database write so no phase depends on the one before it.

Planning lives in [`docs/features/unified-pipeline/`](docs/features/unified-pipeline/):

| File | What it is |
|------|-----------|
| `decision-log.md` | Signed-off decisions — read this first |
| `feature_r&d.md` | Brain dump, measured database facts, title-normalization research |
| `db-entries.md` | Field-by-field shape of the current Job and Company records |
| `location-research/` | Proposed `location_match` rule, tested against all 1,853 jobs |

Path-scoped rules describing the old architecture moved to `legacy/rules/`, so they no longer apply. New rules get written as the new pipeline takes shape.

## Terminology

- **Collector:** Tool that pulls raw job list from Aggregators and ATS Systems
- **Dedupe:** Three-stage system that removes duplicate jobs at different pipeline points (by URL ×2, then by content with parser priority)
- **Resolver/Resolution:** Following job posting links and redirects, especially from aggregators, in an attempt to find the source posting with the most accurate information.
- **Parser:** Tool that takes the best job posting url and extracts key information.
- **User:** Me, the person who built this app.
- **Web View**: A simple, semi-static web representation of our data

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |
