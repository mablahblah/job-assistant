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

---

## Roadmap

### Done

- [x] **Project scaffold** — `create-next-app` with TypeScript + Tailwind, Prisma + SQLite, `.env.local` template, basic folder structure, Dockerfile for UNRAID deployment
- [x] **Connect to GIT** — `git init`, remote connected, `/start-feature` creates feature branches, `/commit` stages + commits + pushes, `/ship-feature` opens and merges PRs via `gh`

### Up Next

- [ ] **Jobs table UI** — sortable/filterable table, status badges, score column, "Scrape Now" button

### Soon

- [ ] **Database schema** — Job, Company, ScrapingRun models; migrations; seed data
- [ ] **Database schema** — Job, Company, ScrapingRun models; migrations; seed data
- [ ] **First scraper** — Adzuna API (free, no browser needed); orchestrator skeleton; scoring engine

### Later

- [ ] **More scrapers** — Greenhouse/Lever (per-company API), LinkedIn (RapidAPI), Playwright scrapers for Dribbble / Lensa / weloveproduct.co
- [ ] **Cron scheduler** — node-cron inside Next.js, auto-scrape every 6h, mark stale jobs
- [ ] **Job detail view** — description, scoring breakdown, notes, status management
- [ ] **Company list manager** — UI to manage Greenhouse/Lever company slugs, pre-seeded list

### Fuzzy / Future

- [ ] **Figma integration** — Claude API generates copy suggestions; Figma MCP creates/edits resume + cover letter frames per job
- [ ] **Application tracking** — richer status pipeline, applied date, interview notes
- [ ] **Notifications / digest** — daily summary of new high-score jobs (email or local notification)
