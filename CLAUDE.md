# Job Search Assistant

A CLI tool (via Claude Code commands) to automate the Product Designer job search: scrape jobs, score and track them, manage applications.

## How to Run

- `npx tsx scripts/scrape.ts` — run all enabled scrapers, output JSON
- `npx tsx scripts/cli.ts <subcommand>` — DB operations (backlog, active, status, score, alignment, etc.)
- `/job-search` — full pipeline: scrape → classify → score → investigate → present
- `/score-companies` — score unscored companies via web research
- `/change-status` — change a job's status
- `/view-backlog` — ranked backlog jobs
- `/view-active-jobs` — jobs in the application pipeline
- `/view-log` — TWC work search activity log

## Rules

- Use `/start-feature` to kick off each feature, `/ship-feature` to wrap up. `/ship-feature` updates CLAUDE.md with decisions, patterns, and architectural changes.
- Roadmap lives in [ROADMAP.md](ROADMAP.md) (read during `/start-feature` and `/ship-feature`). Completed items in [ROADMAP-DONE.md](ROADMAP-DONE.md).
- Commit work after every completed to-do.
- Before starting any feature, work through the UX flow, edge cases, and UI decisions conversationally with me. Do not produce a plan or ask for confirmation — just talk it through.
- CLAUDE.md updates should only include non-obvious guidelines for future work, not app documentation. Domain-specific rules go in CLAUDE.md files closer to the code (e.g. `lib/scrapers/CLAUDE.md`).

## Domain Rules

- **Scoring, company data model, job alignment** → read [`.claude/rules/scoring.md`](.claude/rules/scoring.md)
- **Scrapers** → read [`.claude/rules/scrapers.md`](.claude/rules/scrapers.md)
- **Work search log, company enrichment** → read [`.claude/rules/work-search-log.md`](.claude/rules/work-search-log.md)
- **Job alignment profile & rubric** → read [`.claude/rules/job-alignment.md`](.claude/rules/job-alignment.md)

## Testing & Linting

- **Testing** — vitest for unit and integration tests. Run `npx vitest` to execute. Scraper integration tests mock `fetchWithTimeout` via `vi.mock`.
- **Linting** — ESLint configured in `.eslintrc.json` with `@typescript-eslint`. Run `npm run lint` before shipping.

## Tech Stack

- TypeScript + Prisma + SQLite (libsql adapter)
- CLI scripts via `tsx`
- Playwright for browser-based scrapers
- Claude Code commands for user-facing workflows

## Documentation

Human-facing docs live in `docs/`. Do not read them during normal tasks.


## Code Exploration Policy

Always use jCodemunch-MCP tools for code navigation. Never fall back to Read, Grep, Glob, or Bash for code exploration.
**Exception:** Use `Read` when you need to edit a file — the agent harness requires a `Read` before `Edit`/`Write` will succeed. Use jCodemunch tools to *find and understand* code, then `Read` only the specific file you're about to modify.

**Start any session:**
1. `resolve_repo { "path": "." }` — confirm the project is indexed. If not: `index_folder { "path": "." }`
2. `suggest_queries` — when the repo is unfamiliar

**Finding code:**
- symbol by name → `search_symbols` (add `kind=`, `language=`, `file_pattern=`, `decorator=` to narrow)
- decorator-aware queries → `search_symbols(decorator="X")` to find symbols with a specific decorator (e.g. `@property`, `@route`); combine with set-difference to find symbols *lacking* a decorator (e.g. "which endpoints lack CSRF protection?")
- string, comment, config value → `search_text` (supports regex, `context_lines`)
- database columns (dbt/SQLMesh) → `search_columns`

**Reading code:**
- before opening any file → `get_file_outline` first
- one or more symbols → `get_symbol_source` (single ID → flat object; array → batch)
- symbol + its imports → `get_context_bundle`
- specific line range only → `get_file_content` (last resort)

**Repo structure:**
- `get_repo_outline` → dirs, languages, symbol counts
- `get_file_tree` → file layout, filter with `path_prefix`

**Relationships & impact:**
- what imports this file → `find_importers`
- where is this name used → `find_references`
- is this identifier used anywhere → `check_references`
- file dependency graph → `get_dependency_graph`
- what breaks if I change X → `get_blast_radius`
- what symbols actually changed since last commit → `get_changed_symbols`
- find unreachable/dead code → `find_dead_code`
- class hierarchy → `get_class_hierarchy`

## Session-Aware Routing

**Opening move for any task:**
1. `plan_turn { "repo": "...", "query": "your task description" }` — get confidence + recommended files
2. Obey the confidence level:
   - `high` → go directly to recommended symbols, max 2 supplementary reads
   - `medium` → explore recommended files, max 5 supplementary reads
   - `low` → the feature likely doesn't exist. Report the gap to the user. Do NOT search further hoping to find it.

**Interpreting search results:**
- If `search_symbols` returns `negative_evidence` with `verdict: "no_implementation_found"`:
  - Do NOT re-search with different terms hoping to find it
  - Do NOT assume a related file (e.g. auth middleware) implements the missing feature (e.g. CSRF)
  - DO report: "No existing implementation found for X. This would need to be created."
  - DO check `related_existing` files — they show what's nearby, not what exists
- If `verdict: "low_confidence_matches"`: examine the matches critically before assuming they implement the feature

**After editing files:**
- If PostToolUse hooks are installed (Claude Code only), edited files are auto-reindexed
- Otherwise, call `register_edit` with edited file paths to invalidate caches and keep the index fresh
- For bulk edits (5+ files), always use `register_edit` with all paths to batch-invalidate

**Token efficiency:**
- If `_meta` contains `budget_warning`: stop exploring and work with what you have
- If `auto_compacted: true` appears: results were automatically compressed due to turn budget
- Use `get_session_context` to check what you've already read — avoid re-reading the same files
