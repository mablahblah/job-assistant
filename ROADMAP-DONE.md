# Completed Features

<!-- Chronological order — newest at bottom -->

- [x] **Project scaffold** — `create-next-app` with TypeScript + Tailwind, Prisma + SQLite, `.env.local` template, basic folder structure, Dockerfile for UNRAID deployment
- [x] **Connect to GIT** — `git init`, remote connected, `/start-feature` creates feature branches, `/commit` stages + commits + pushes, `/ship-feature` opens and merges PRs via `gh`
- [x] **Jobs table UI** — scored jobs table with weighted formula (employee/customer satisfaction, work-life balance, political alignment, benefits + posting age decay), applied checkbox with in-memory save, mock data for 6 companies and 12 jobs
- [x] **Database schema** — Company, Job, ScrapingRun models with Prisma + SQLite (libsql adapter); location + workMode fields; status pipeline (new → applied → screened → interviewed → tested → offer → rejected); server action for toggling applied status; seed script with 6 companies and 12 jobs
- [x] **First scraper** — Adzuna API (US, "Product Designer"), orchestrator with ScrapingRun tracking, deduplication by URL, placeholder company/job ratings; "Scrape Now" + "Delete All" UI buttons
- [x] **Role/title search config** — `SearchTerm` DB model; UI with input + "+" button and removable badge pills below page title; `addSearchTerm`/`removeSearchTerm` server actions; orchestrator scrapes all active terms in parallel and deduplicates by URL
- [x] **Scrape-only data** — removed mock companies/jobs and seed data entirely; app starts empty and relies on scraper for all data; scrape no-ops gracefully when no search terms are configured
- [x] **Search term → job tracking** — `JobSource` join table links jobs to the search term(s) that found them; orphaned jobs (all source terms removed) are cleaned up on next scrape; multi-term overlap protected; search bar UI redesigned with inline + button, "Search Jobs" / red "Delete All" toggle, divider layout
- [x] **Companies page** — nav bar (Jobs | Companies); companies table with auto-saving 1–5 score dropdowns, "Missing scores only" filter, per-company delete; all 5 scores nullable on Company model (benefits moved from Job → Company); company entries persist across scrapes; placeholder ratings removed
- [x] **Design system cleanup** — switched to Phosphor Icons (bold default, duotone for active states); removed dark theme; extracted Tailwind color/style utilities into semantic CSS classes (`.btn-primary`, `.table`, `.badge`, etc.) with CSS custom properties for the color palette; Tailwind retained for layout only (grid/flex/padding/margins); new palette: near-white bg, cream secondary, teal accent, deep purple text
- [x] **Jobs table UI overhaul** — full column header labels (two-line, vertically centered); status column replaced checkbox with pencil icon + inline native select (auto-closes on selection); work mode displayed as icon inline with location (WifiHigh/Bicycle/BuildingOffice, no badge/label); salary reformatted as `$120-150k`
