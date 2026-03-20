# Roadmap

Completed features are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## 🔥🔥 Medium Priority

- [ ] **Status Sorting** - The status of the application will affect it's sorting in the tablet
- [ ] **Scraping improvements**
  - [ ] **Scraper performance** — parallelize Greenhouse (9 slugs) and Lever (10 slugs) API calls with `Promise.allSettled`; refactor Dribbble to accept all queries in a single browser session like WeLoveProduct
  - [ ] **Scraper modal progress** — better feedback during long scrapes (e.g. elapsed time, per-detail-page progress for Playwright scrapers) so it doesn't look like it's hanging
  - [ ] Scrape results summary — show what was pulled after a scrape runs
- [ ] **Deployment** — Docker on UNRAID or Vercel subdomain (TBD); migrations on start, persistent DB, CI/CD auto-deploy
- [ ] **Full titles in company page** - Scoring titles should be updated to be full titles, like jobs page
- [ ] **Misc. UI/UX Improvements**
  - Update font to Nunito Sans
  - Make table fully responsive
  - Job metadata saved (src job board, yearly salary, anything else?)
  - Number of jobs next to filter instead of next to title
  - Update color palette
  - Layout cleanup
- [ ] **More Job APIs**

## 🔥 Lower Priority

- [ ] **Save UX friction** — saving takes min 2s with a loading animation (intentional friction)
- [ ] **Color Accessibility Audit**
- [ ] **UI Improvements** - Improve layout, styling, colors, make sure all icons are regular and not bold, update import/export icons, improve styles of import modal (monospace font, make it feel more like a terminal)

## Ideas / Unsure

- [ ] **Job detail view** — description, scoring breakdown, location/workMode display, notes, status management
- [ ] **Figma integration** — Claude API generates copy suggestions; Figma MCP creates/edits resume + cover letter frames per job
- [ ] **AI enrichment** — LLM-powered scoring (Gemini free tier explored, deferred for now in favor of manual scoring + exportable prompt)
- [ ] **Application tracking UI** — full status pipeline dropdown, applied date, interview notes (schema already supports this)
- [ ] **Notifications / digest** — daily summary of new high-score jobs (email or local notification)
- [ ] **Company list manager** — UI to manage Greenhouse/Lever company slugs (currently in `scraper-config.ts`), pre-seeded list

## Cancelled

- [ ] **Cron scheduler** — node-cron inside Next.js, auto-scrape every 6h, mark stale jobs
