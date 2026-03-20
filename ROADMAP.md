# Roadmap

Completed features are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## 🔥🔥🔥 High Priority

- [ ] **Salary scoring** — incorporate salary range into the weighted scoring formula
- [ ] **Location/job type filtering** — reject jobs that can't be applied for (remote-only, wrong location, etc.)
- [ ] **Status UX improvement** — improve the job status pipeline experience
- [ ] **Company list manager** — UI to manage Greenhouse/Lever company slugs (currently in `scraper-config.ts`), pre-seeded list
- [ ] **Figma integration** — Claude API generates copy suggestions; Figma MCP creates/edits resume + cover letter frames per job

## 🔥🔥 Medium Priority

- [ ] **Scraping improvements**
  - [ ] **Scraper performance** — parallelize Greenhouse (9 slugs) and Lever (10 slugs) API calls with `Promise.allSettled`; refactor Dribbble to accept all queries in a single browser session like WeLoveProduct
  - [ ] **Scraper modal progress** — better feedback during long scrapes (e.g. elapsed time, per-detail-page progress for Playwright scrapers) so it doesn't look like it's hanging
  - [ ] Auto-delete job postings older than 1 week (manual "clean" function or part of scrape flow)
  - [ ] Scrape results summary — show what was pulled after a scrape runs
  - [ ] Extrapolate hourly rates to yearly salary
- [ ] **Job detail view** — description, scoring breakdown, location/workMode display, notes, status management
- [ ] **Application tracking UI** — full status pipeline dropdown, applied date, interview notes (schema already supports this)
- [ ] **Deployment** — Docker on UNRAID or Vercel subdomain (TBD); migrations on start, persistent DB, CI/CD auto-deploy
- [ ] **Notifications / digest** — daily summary of new high-score jobs (email or local notification)
- [ ]

## 🔥 Lower Priority

- [ ] **Save UX friction** — saving takes min 2s with a loading animation (intentional friction)
- [ ] **Color Accessibility Audit**
- [ ] **AI enrichment** — LLM-powered scoring (Gemini free tier explored, deferred for now in favor of manual scoring + exportable prompt)

## Cancelled

- [ ] **Cron scheduler** — node-cron inside Next.js, auto-scrape every 6h, mark stale jobs
