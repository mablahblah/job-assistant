# Roadmap

Completed features are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## 🔥🔥🔥 High Priority

- [ ] **Scraper on/off config** — UI or code-level toggle to enable/disable individual scrapers
- [ ] **Test & tune scrapers** — verify each scraper returns quality results, fix edge cases and failures
- [ ] **Salary scoring** — incorporate salary range into the weighted scoring formula
- [ ] **Location/job type filtering** — reject jobs that can't be applied for (remote-only, wrong location, etc.)
- [ ] **Status UX improvement** — improve the job status pipeline experience
- [ ] **Company list manager** — UI to manage Greenhouse/Lever company slugs, pre-seeded list
- [ ] **Figma integration** — Claude API generates copy suggestions; Figma MCP creates/edits resume + cover letter frames per job

## 🔥🔥 Medium Priority

- [ ] **Scraping improvements**
  - [ ] Auto-delete job postings older than 1 week (manual "clean" function or part of scrape flow)
  - [ ] Scrape results summary — show what was pulled after a scrape runs
- [ ] **Job detail view** — description, scoring breakdown, location/workMode display, notes, status management
- [ ] **Application tracking UI** — full status pipeline dropdown, applied date, interview notes (schema already supports this)
- [ ] **Deployment** — Docker on UNRAID or Vercel subdomain (TBD); migrations on start, persistent DB, CI/CD auto-deploy
- [ ] **Notifications / digest** — daily summary of new high-score jobs (email or local notification)

## 🔥 Lower Priority

- [ ] **Save UX friction** — saving takes min 2s with a loading animation (intentional friction)
- [ ] **Color Accessibility Audit**
- [ ] **AI enrichment** — LLM-powered scoring (Gemini free tier explored, deferred for now in favor of manual scoring + exportable prompt)

## Cancelled

- [ ] **Cron scheduler** — node-cron inside Next.js, auto-scrape every 6h, mark stale jobs
