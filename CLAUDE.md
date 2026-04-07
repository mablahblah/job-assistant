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

## Domain Rules

- **UI/CSS/animations** → read [`.claude/rules/ui.md`](.claude/rules/ui.md)
- **Scoring, company data model, score import** → read [`.claude/rules/scoring.md`](.claude/rules/scoring.md)
- **Scrapers** → read [`.claude/rules/scrapers.md`](.claude/rules/scrapers.md)

## Testing & Linting

- **Testing** — vitest for unit and integration tests. Run `npx vitest` to execute. Scraper integration tests mock `fetchWithTimeout` via `vi.mock`.
- **Linting** — ESLint configured in `.eslintrc.json` with `@typescript-eslint`. Run `npm run lint` before shipping.

## Tech Stack

- Next.js 14 + TypeScript + Tailwind (layout-only)
- Prisma + SQLite (libsql adapter)
- Server actions for mutations (no API routes)
- Docker for UNRAID deployment
