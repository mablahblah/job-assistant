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

## Commands

```bash
npx tsx scripts/cli.ts backlog        # Shows ranked backlog jobs, auto-expires posts older than 8 days
npx tsx scripts/cli.ts active         # Shows jobs currently in the application pipeline
npx tsx scripts/cli.ts log            # Shows TWC work search activity log
npx tsx scripts/cli.ts enrich-log     # Fills in missing company address/phone/website on log entries
npx tsx scripts/cli.ts status         # Batch update job statuses via JSON on stdin
npx tsx scripts/cli.ts score          # Save company scores for a single company
npx tsx scripts/cli.ts alignment      # Batch update job alignment scores via JSON on stdin
npx tsx scripts/cli.ts flag-mismatch  # Batch flag work-mode mismatches via JSON on stdin
npx tsx scripts/cli.ts unscored       # Lists companies that haven't been scored yet
npx tsx scripts/cli.ts new-jobs       # Lists jobs collected in the most recent run
npx tsx scripts/cli.ts expire         # Marks backlog jobs older than 8 days as expired
npx tsx scripts/cli.ts geocode-class  # Manage geocoding class allow/block rules
npx tsx scripts/cli.ts classify-held-back <file>  # Re-classify and save held-back jobs after updating geo class rules
npx tsx scripts/serve.ts              # Starts local dashboard on port 3000
npm run lint                          # Run ESLint across the project
npm run test                          # Run all Vitest tests
```

## Architecture

```
lib/
├── collectors/       # Job collection from external sources (API + Playwright)
├── geocoding/        # Geo-based location classification (geocode, cache, prefilter, classify)
├── parsers/          # ATS-specific job page parsers (Greenhouse, Lever, Ashby, etc.)
├── scrapers/         # Legacy scrapers (replaced by collectors + parsers)
├── shared-utils/     # Pure utility functions shared across lib/ modules
├── web/              # Dashboard HTML rendering and helpers
├── pipeline.ts       # Collect → dedupe → resolve → route → parse → dedupe → geo-classify → save
├── pipeline-save.ts  # Save parsed pipeline results to DB
├── dedupe.ts         # Three-stage deduplication with parser priority
├── scoring.ts        # Company + job composite scoring
├── url-resolver.ts   # Follow redirects to resolve final job URLs
├── blacklist.ts      # Company blacklist filtering
├── batch-update.ts   # Batch status, alignment, and flag-mismatch updates
├── location.ts       # Location parsing and normalization
├── company-enrichment.ts  # Enrich companies with address/phone/website
├── work-search-log.ts     # TWC work search activity log entries
└── prisma.ts         # Prisma client singleton
scripts/
├── cli.ts            # CLI subcommands for DB operations
├── serve.ts          # Local dashboard web server
├── pipeline.ts       # Dry-run pipeline for parser development
├── resolve-urls.ts   # Bulk URL resolution diagnostic
├── validate-adzuna.ts # Adzuna collector diagnostic
└── seed-repost-dates.ts  # Seed repostedAt for RP pill visual testing
prisma/               # Schema, migrations, seed data
public/               # Dashboard static assets (CSS, JS)
docs/                 # Human-facing documentation, not read during normal tasks
docs/CURRENT-FEATURE.md  # Current feature we are actively working on
docs/BACKLOG.md          # Future work we have not started yet
```

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
