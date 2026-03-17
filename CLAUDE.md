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
- [x] **Jobs table UI** — scored jobs table with weighted formula (employee/customer satisfaction, work-life balance, political alignment, benefits + posting age decay), applied checkbox with in-memory save, mock data for 6 companies and 12 jobs
- [x] **Database schema** — Company, Job, ScrapingRun models with Prisma + SQLite (libsql adapter); location + workMode fields; status pipeline (new → applied → screened → interviewed → tested → offer → rejected); server action for toggling applied status; seed script with 6 companies and 12 jobs
- [x] **First scraper** — Adzuna API (US, "Product Designer"), orchestrator with ScrapingRun tracking, deduplication by URL, placeholder company/job ratings; "Scrape Now" + "Delete All" UI buttons
- [x] **Role/title search config** — `SearchTerm` DB model; UI with input + "+" button and removable badge pills below page title; `addSearchTerm`/`removeSearchTerm` server actions; orchestrator scrapes all active terms in parallel and deduplicates by URL

### Up Next

- [ ] **Scrape-only data** — remove seeded mock companies/jobs; seed script only creates default search terms; app relies entirely on scraper for job data
- [ ] **Search term → job tracking** — `JobSource` join table links jobs to the search term(s) that found them; removing a search term auto-deletes jobs that have no other source term; protects jobs with no source (manually added)
- [ ] **Claude enrichment** — Claude API scores companies (employee/customer satisfaction, work-life balance, political alignment) and jobs (benefits) from descriptions; local prompt config for criteria definitions
- [ ] **Job detail view** — description, scoring breakdown, location/workMode display, notes, status management
- [ ] **Cron scheduler** — node-cron inside Next.js, auto-scrape every 6h, mark stale jobs

### Later

- [ ] **More scrapers** — Greenhouse/Lever (per-company API), LinkedIn (RapidAPI), Playwright scrapers for Dribbble / Lensa / weloveproduct.co
- [ ] **Company list manager** — UI to manage Greenhouse/Lever company slugs, pre-seeded list
- [ ] **Application tracking UI** — full status pipeline dropdown, applied date, interview notes (schema already supports this)
- [ ] **Deployment** — Docker on UNRAID or Vercel subdomain (TBD); migrations on start, persistent DB, CI/CD auto-deploy

### Fuzzy / Future

- [ ] **Figma integration** — Claude API generates copy suggestions; Figma MCP creates/edits resume + cover letter frames per job
- [ ] **Notifications / digest** — daily summary of new high-score jobs (email or local notification)
