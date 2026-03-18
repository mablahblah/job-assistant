# Roadmap

Completed features are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## Up Next

- [ ] **Job detail view** — description, scoring breakdown, location/workMode display, notes, status management

## Sooner

- [ ] **Exportable Company Prompt** — download a prompt, pre-filled, to drop into Claude; it will return scores for companies with missing values across the 5 categories
- [ ] **Application tracking UI** — full status pipeline dropdown, applied date, interview notes (schema already supports this)
- [ ] **More scrapers** — Greenhouse/Lever (per-company API), LinkedIn (RapidAPI), Playwright scrapers for Dribbble / Lensa / weloveproduct.co

## Later

- [ ] **Company list manager** — UI to manage Greenhouse/Lever company slugs, pre-seeded list
- [ ] **Deployment** — Docker on UNRAID or Vercel subdomain (TBD); migrations on start, persistent DB, CI/CD auto-deploy

## Fuzzy

- [ ] **AI enrichment** — LLM-powered scoring (Gemini free tier explored, deferred for now in favor of manual scoring + exportable prompt)
- [ ] **Figma integration** — Claude API generates copy suggestions; Figma MCP creates/edits resume + cover letter frames per job
- [ ] **Notifications / digest** — daily summary of new high-score jobs (email or local notification)

## Cancelled

- [ ] **Cron scheduler** — node-cron inside Next.js, auto-scrape every 6h, mark stale jobs
