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

> Domain-specific rules live in CLAUDE.md files closer to the code (e.g. `components/CLAUDE.md`, `lib/scrapers/CLAUDE.md`). Only record decisions here that are non-obvious and affect consistency across the whole project.

## Key Decisions & Patterns

- **Auto-save UX** — no Save buttons; dropdowns and checkboxes fire server actions immediately via `useTransition`. Show "Saving..." in header while pending.
- **Null scores** — all 5 company scores (ES, CS, W/L, PA, Benefits) are nullable. Null displays as "?" in UI, treated as 0 in scoring formula (unscored companies sink to bottom).
- **Benefits on Company** — benefits is a company-level score, not per-job.
- **Company persistence** — company entries persist in DB even when no jobs reference them. Manual delete available on companies page.
- **Scoring scale** — all scores 1–5, weighted formula totals 0–100 with posting age decay.
  - Weights: ES 25 + CS 15 + W/L 30 + PA 10 + Benefits 20 = 100
  - Formula: `sum((score ?? 0) / 5 * weight) * ageModifier`, rounded to nearest int
  - Age modifier: 1.0 if ≤3 days old, then decays by 0.05/day, floor 0.5 (posts never lose more than half their score from age)
- **Company score import format** — Claude returns a JSON array keyed by `company` (matches DB unique name). All 5 score fields per entry; import fully overwrites existing scores. Strip markdown fences before parsing.
- **Scraper config** — `lib/scrapers/scraper-config.ts` is the single source of truth for which scrapers run and which Greenhouse/Lever slugs are used. Set `enabled: false` to silently skip a scraper. No UI — edit the file directly.

## Tech Stack

- Next.js 14 + TypeScript + Tailwind (layout-only)
- Prisma + SQLite (libsql adapter)
- Server actions for mutations (no API routes)
- Docker for UNRAID deployment
