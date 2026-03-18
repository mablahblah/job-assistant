# Job Search Assistant

A local Next.js app to automate the Product Designer job search: scrape jobs, score and track them, and generate tailored Figma resume/cover letter frames via Claude + Figma MCP.

## User Flow

1. Open app → view scored jobs table (auto-scraped on schedule, or manually triggered)
2. Click into top opportunities → run Figma generation (new resume + cover letter frames)
3. Finalize edits in Figma, apply externally
4. Mark job as "applied" and track status through the pipeline

## Working Agreements

- Build feature by feature, decisions made as we go
- After each feature: test it manually, then update this roadmap
- Near-term items are specific; further out stays intentionally blurry
- Use `/start-feature` to kick off each feature, `/ship-feature` to wrap up
- `/ship-feature` should update CLAUDE.md with any decisions made, patterns established, or architectural changes during the feature
- Roadmap lives in [ROADMAP.md](ROADMAP.md) (read during `/start-feature` and `/ship-feature`). Completed items in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## Key Decisions & Patterns

- **Auto-save UX** — no Save buttons; dropdowns and checkboxes fire server actions immediately via `useTransition`. Show "Saving..." in header while pending.
- **Null scores** — all 5 company scores (ES, CS, W/L, PA, Benefits) are nullable. Null displays as "?" in UI, treated as 0 in scoring formula (unscored companies sink to bottom).
- **Benefits on Company** — benefits is a company-level score, not per-job. Moved from Job → Company model.
- **Company persistence** — company entries persist in DB even when no jobs reference them. Manual delete available on companies page.
- **Scoring scale** — all scores 1–5, weighted formula totals 0–100 with posting age decay.

## Tech Stack

- Next.js 14 + TypeScript + Tailwind
- Prisma + SQLite (libsql adapter)
- Server actions for mutations (no API routes)
- Docker for UNRAID deployment
