# Roadmap

Completed features are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

# MVP

## As a user I can scrape the ideal job boards so I don't have to manually seek out jobs on said boards

- [ ] **Scraping improvements**
  - [ ] **Scraper performance** — parallelize Greenhouse (9 slugs) and Lever (10 slugs) API calls with `Promise.allSettled`; refactor Dribbble to accept all queries in a single browser session like WeLoveProduct
  - [ ] **Scraper modal progress** — better feedback during long scrapes (e.g. elapsed time, per-detail-page progress for Playwright scrapers) so it doesn't look like it's hanging
  - [ ] Scrape results summary — show what was pulled after a scrape runs
  - [ ] Scraper UI improvements (looks like a "terminal" application)

## As a user I can track my application process using the job assistant to keep track of jobs I am applying for intuitively

- [ ] - **Logfile** - Any change, scrape, user action, etc will be logged in a logfile (as well as trigger a console message).
- [ ] - **Modified Date Saved in db** - If a status is changed, there will be a modified date set in db (not exposed to user).
- [ ] **Status Sorting** - The status of the application will affect it's sorting in the table. 4 Unique collapsible sections (In Progress (sorted by modified date), Backlog (sorted by score), Rejected (sorted by modified date), Too Far (sorted by score)).
- [ ] - **\*Too Far Filter** - A new status will be created called "Too Far", these will be automatically attached to in-person and hybrid jobs outside of Austin. This will be an option in the dropdown, so they can be undone manually.
- [ ] - **Manual Deleting** - Bulk delete remains, but each individual job can be deleted. A delete removes a job from the view, but it should also auto-reject those jobs from future scrapes.
- [ ] - **Old Post Age Status** - Posts older than 7 days still get rejected on scrape, but posts that become too old after they have been scraped are automatically set to a NEW state called "expired."

## As a user I can click an action to auto-generate a resume and cover letter in Figma so I can speed up the application process

- [ ] - **Initial Figma MCP Connection** - User can trigger a job that duplicates the generic resume and cover letters and properly renames them in Figma

# Improvements

## 🔥🔥 Medium Priority

- **UX/UI Improvement Pass 2**
  - Color Palette Update — audit and reconcile old purple/pink palette to new blue/neutral theme tokens; button + link colors
  - Header Layout cleanup
  - Separate column for type... include label on xl desktops and tooltip on smaller screens
- **Expand List of Scrapers**

## 🔥 Lower Priority

- [ ] **Save UX friction** — saving takes min 2s with a loading animation (intentional friction)
- [ ] **Color Accessibility Audit**
- [ ] **UI Improvements** - Improve layout, styling, colors, make sure all icons are regular and not bold, update import/export icons, improve styles of import modal (monospace font, make it feel more like a terminal)
- [ ] **Deployment** — Docker on UNRAID or Vercel subdomain (TBD); migrations on start, persistent DB, CI/CD auto-deploy
- [ ] **Full titles in company page** - Scoring titles should be updated to be full titles, like jobs page

- [ ] **More Job APIs**

## Ideas / Unsure

- [ ] **Job detail view** — description, scoring breakdown, location/workMode display, notes, status management
- [ ] **Figma integration** — Claude API generates copy suggestions; Figma MCP creates/edits resume + cover letter frames per job
- [ ] **AI enrichment** — LLM-powered scoring (Gemini free tier explored, deferred for now in favor of manual scoring + exportable prompt)
- [ ] **Application tracking UI** — full status pipeline dropdown, applied date, interview notes (schema already supports this)
- [ ] **Notifications / digest** — daily summary of new high-score jobs (email or local notification)
- [ ] **Company list manager** — UI to manage Greenhouse/Lever company slugs (currently in `scraper-config.ts`), pre-seeded list

## Cancelled

- [ ] **Cron scheduler** — node-cron inside Next.js, auto-scrape every 6h, mark stale jobs
