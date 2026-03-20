# Job Search Assistant

A local Next.js app to automate the Product Designer job search: scrape jobs, score and track them, and generate tailored Figma resume/cover letter frames via Claude + Figma MCP.

## Commands

- Run `npm run dev` to build

## Working Agreements

- After each feature: test it manually, then update this roadmap.
- Include eli5 comments when updating code explaing what code does in plan english and why. Keep to 1 line if possible.
- When suggesting code changes, or making any changes in the app, explain to user what you're doing and why.
- Use `/start-feature` to kick off each feature, `/ship-feature` to wrap up.
- `/ship-feature` should update CLAUDE.md with any decisions made, patterns established, or architectural changes during the feature.
- Roadmap lives in [ROADMAP.md](ROADMAP.md) (read during `/start-feature` and `/ship-feature`). Completed items in [ROADMAP-DONE.md](ROADMAP-DONE.md).
- Commit work after every completed to-do.
- Before starting any feature, work through the UX flow, edge cases, and UI decisions conversationally with me. Do not produce a plan or ask for confirmation to proceed — just talk it through until we've covered the problem space together.
- CLAUDE.md updates should not contain app documentation, rather they should only include guidelines for future work

> Domain-specific rules live in CLAUDE.md files closer to the code (e.g. `components/CLAUDE.md`, `lib/scrapers/CLAUDE.md`). Only record decisions here that are non-obvious and affect consistency across the whole project.

## Key Decisions & Patterns

- **Auto-save UX** — no Save buttons; dropdowns and checkboxes fire server actions immediately via `useTransition`. Show "Saving..." in header while pending.
- **Null scores** — all 5 company scores (ES, CS, W/L, PA, Benefits) are nullable. Null displays as "?" in UI, treated as 0 in scoring formula (unscored companies sink to bottom).
- **Benefits on Company** — benefits is a company-level score, not per-job.
- **Company persistence** — company entries persist in DB even when no jobs reference them. Manual delete available on companies page.
- **Scoring scale** — all scores 1–5, weighted formula capped at 0–100 with two multipliers (age + salary). Weights are relative — they don't need to sum to 100.
  - Formula: `sum((score ?? 0) / 5 * weight) * ageModifier * salaryModifier`, rounded to nearest int, capped 0–100
  - Age modifier: 1.0 if ≤3 days old, then decays by 0.05/day, floor 0.5 (posts never lose more than half their score from age)
  - Salary modifier: ±0.1× per $25k gap from `TARGET_SALARY` (set in `lib/scoring.ts`); neutral 1.0× when salary unknown; hourly annualized ×2080, monthly ×12; no floor/ceiling
- **Company score import format** — Claude returns a JSON array keyed by `company` (matches DB unique name). All 5 score fields per entry; import fully overwrites existing scores. Strip markdown fences before parsing.
- **Scraper config** — `lib/scrapers/scraper-config.ts` is the single source of truth for which scrapers run and which Greenhouse/Lever slugs are used. Set `enabled: false` to silently skip a scraper. No UI — edit the file directly.
- **Shared scraper utilities** — `lib/scrapers/fetch-utils.ts` is the single shared utility layer for all scrapers. New scrapers should import from here rather than rolling their own salary parsing, work mode detection, etc. Domain-specific scraper rules live in `lib/scrapers/CLAUDE.md`.
- **Two scraper patterns** — scrapers are wired up in one of two ways in `scraper-actions.ts`:
  - *Per-search-term* (Adzuna, Dribbble): uses `runSearchTermScraper`, called once per user search term, saves under that term's ID.
  - *System-term* (jSearch, WeLoveProduct, Greenhouse, Lever): collects all user terms itself, runs its own fixed search logic, saves under a `__name__` system term via `getOrCreateSystemTerm`. Use this pattern when the scraper needs to combine or transform terms (e.g. OR queries, location variants) rather than run them independently.
- **Testing** — vitest for unit and integration tests. Run `npx vitest` to execute. Scraper integration tests mock `fetchWithTimeout` via `vi.mock`.

## Tech Stack

- Next.js 14 + TypeScript + Tailwind (layout-only)
- Prisma + SQLite (libsql adapter)
- Server actions for mutations (no API routes)
- Docker for UNRAID deployment
