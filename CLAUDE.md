# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.


# Job Search Assistant

A local Next.js app to automate the Product Designer job search: scrape jobs, score and track them, and generate tailored Figma resume/cover letter frames via Claude + Figma MCP.

## Commands

- Run `npm run dev` to build

## Working Agreements

- Include eli5 comments when updating code explaining what code does in plain english and why. Keep to 1 line if possible.
- When suggesting or making code changes, explain what you're doing and why.
- Use `/start-feature` to kick off each feature, `/ship-feature` to wrap up. `/ship-feature` updates CLAUDE.md with decisions, patterns, and architectural changes.
- Roadmap lives in [ROADMAP.md](ROADMAP.md) (read during `/start-feature` and `/ship-feature`). Completed items in [ROADMAP-DONE.md](ROADMAP-DONE.md).
- Commit work after every completed to-do.
- Before starting any feature, work through the UX flow, edge cases, and UI decisions conversationally with me. Do not produce a plan or ask for confirmation — just talk it through.
- CLAUDE.md updates should only include non-obvious guidelines for future work, not app documentation. Domain-specific rules go in CLAUDE.md files closer to the code (e.g. `components/CLAUDE.md`, `lib/scrapers/CLAUDE.md`).

## Key Decisions & Patterns

- **Auto-save UX** — no Save buttons; dropdowns and checkboxes fire server actions immediately via `useTransition`. Show "Saving..." in header while pending.
- **Null scores** — all 5 company scores (ES, CS, W/L, PA, Benefits) are nullable. Null displays as "?" in UI, treated as 0 in scoring formula (unscored companies sink to bottom).
- **Benefits on Company** — benefits is a company-level score, not per-job.
- **Company persistence** — company entries persist in DB even when no jobs reference them. Manual delete available on companies page.
- **Scoring scale** — all scores 1–5, weighted formula capped at 0–100 with two multipliers (age + salary). Weights are relative — they don't need to sum to 100.
  - Formula: `sum((score ?? 0) / 5 * weight) * ageModifier * salaryModifier`, rounded to nearest int, capped 0–100
  - Age modifier: 1.5 if <1 day old, 1.0 if 1–3 days, decays 0.05/day after day 3, floor 0.5
  - Salary modifier: ±0.1×/$25k from `TARGET_SALARY` (`lib/scoring.ts`); 1.0× when unknown; hourly ×2080, monthly ×12; no floor/ceiling
- **Company score import format** — Claude returns a JSON array keyed by `company` (matches DB unique name). All 5 score fields per entry plus optional `note`; import fully overwrites existing scores and note. Strip markdown fences before parsing. Export copies prompt to clipboard (shows toast); prompt pre-fills a JSON stub with exact DB company names to prevent name-match failures. Company `note` stores Claude's scoring rationale and appears as a tooltip on the company name in both tables.
- **Tab nav state** — tab switching uses `useState` + `window.history.replaceState` (NOT `router.push` — that triggers a full server re-render in App Router, breaking client state). Status changes keep jobs in the current tab until page refresh, by design.
- **Scrape status cascade** — on save in `scraper-save.ts`, new jobs are auto-classified in order: expired (≥8 days old) → too far (`classifyLocation`) → backlog. On page load, `expireOldBacklogJobs()` also expires any backlog jobs that aged out. In-progress statuses (anything beyond backlog) are never auto-expired.
- **Scraper config** — `lib/scrapers/scraper-config.ts` is the single source of truth for which scrapers run and which Greenhouse/Lever slugs are used. Set `enabled: false` to silently skip a scraper.
- **Shared scraper utilities** — `lib/scrapers/fetch-utils.ts` is the single shared utility layer for all scrapers. New scrapers should import from here rather than rolling their own salary parsing, work mode detection, etc. Domain-specific scraper rules live in `lib/scrapers/CLAUDE.md`.
- **Two scraper patterns** — scrapers are wired up in one of two ways in `scraper-actions.ts`:
  - *Per-search-term* (Adzuna, Dribbble): uses `runSearchTermScraper`, called once per user search term, saves under that term's ID.
  - *System-term* (jSearch, WeLoveProduct, Greenhouse, Lever): collects all user terms itself, runs fixed search logic, saves under a `__name__` system term via `getOrCreateSystemTerm`. Use when the scraper needs to combine or transform terms.
- **Testing** — vitest for unit and integration tests. Run `npx vitest` to execute. Scraper integration tests mock `fetchWithTimeout` via `vi.mock`.
- **Linting** — ESLint configured in `.eslintrc.json` with `@typescript-eslint`. Run `npm run lint` before shipping.
- **Two-tier CSS tokens** — `globals.css` uses theme colors (`--black-100`, `--white-90`, etc.) mapped to semantic tokens (`--color-text`, `--color-control-pill-default`, etc.). Always add new colors as a theme value first, then reference via a semantic variable. Never use raw hex in component styles.
- **CSS breakpoints** — phone `<768px`, tablet `768–1024px`, desktop `1024–1440px`, xl `1440px+`. Root font-size: 14px/16px/18px at these breakpoints. All font-size declarations use `em` (not `rem`/`px`) so they scale proportionally.
- **Lottie animations** — `react-useanimations` + custom Lottie JSONs in `lib/animations/`. Exports from `lib/animations/index.ts` are cast to `Animation` type. Always pass a unique `key` prop to `<UseAnimations>` when the animation may change (e.g. per processing stage) — it only loads on mount and won't update without a remount.

## Tech Stack

- Next.js 14 + TypeScript + Tailwind (layout-only)
- Prisma + SQLite (libsql adapter)
- Server actions for mutations (no API routes)
- Docker for UNRAID deployment
