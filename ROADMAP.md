# Roadmap

Completed features are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## 🔥🔥🔥 High Priority

- [ ] **Status UX improvement** — improve the job status pipeline experience
- [ ] **Company list manager** — UI to manage Greenhouse/Lever company slugs (currently in `scraper-config.ts`), pre-seeded list

## 🔥🔥 Medium Priority

- [ ] **Scraping improvements**
  - [ ] **Scraper performance** — parallelize Greenhouse (9 slugs) and Lever (10 slugs) API calls with `Promise.allSettled`; refactor Dribbble to accept all queries in a single browser session like WeLoveProduct
  - [ ] **Scraper modal progress** — better feedback during long scrapes (e.g. elapsed time, per-detail-page progress for Playwright scrapers) so it doesn't look like it's hanging
  - [ ] Scrape results summary — show what was pulled after a scrape runs
- [ ] **Deployment** — Docker on UNRAID or Vercel subdomain (TBD); migrations on start, persistent DB, CI/CD auto-deploy

## 🔥 Lower Priority

- [ ] **Save UX friction** — saving takes min 2s with a loading animation (intentional friction)
- [ ] **Color Accessibility Audit**

## Ideas / Unsure

- [ ] **Job detail view** — description, scoring breakdown, location/workMode display, notes, status management
- [ ] **Figma integration** — Claude API generates copy suggestions; Figma MCP creates/edits resume + cover letter frames per job
- [ ] **AI enrichment** — LLM-powered scoring (Gemini free tier explored, deferred for now in favor of manual scoring + exportable prompt)
- [ ] **Application tracking UI** — full status pipeline dropdown, applied date, interview notes (schema already supports this)
- [ ] **Notifications / digest** — daily summary of new high-score jobs (email or local notification)

## Cancelled

- [ ] **Cron scheduler** — node-cron inside Next.js, auto-scrape every 6h, mark stale jobs
