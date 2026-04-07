# Roadmap

Completed features are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## Improvements

### _CURRENT_ Initiative: Work Search Activity Log — [initiative doc](docs/initiatives/work-search-log/initiative.md)

_Goal: Automatically log TWC-compliant work search activities on status changes, enrich company data, and provide a weekly log view._

- [x |status:done] - **Work Search Log Data Model & Auto-Logging** — New `WorkSearchEntry` table + auto-create entries when jobs move to applied/screening/interview
- [x |status:done] - **Company Enrichment** — Add address/phone/website to Company model, look up via free API on first log trigger
- [x |status:done] - **Work Search Log UI** — Weekly-grouped /work-log page with sidebar nav, scroll spy, edit modal, enrichment alerts, and 3-activity-per-week tracking
- [x |status:done] - **Apify Enrichment** — Replace Google Places API with Apify Google Search scraper for company address/phone/website; add enrichment status tracking + pending/failed UI states

---

_Goal: Expand data sources, harden security, clean up code health, and polish the UX._

### Initiative: More Data Sources

- [ |status:not started] - **Behance Jobs** — Add Behance job board scraper (behance.net/joblist?category=ui-ux-design)
- [ |status:not started] - **Wellfound** — Add Wellfound scraper (wellfound.com)
- [ |status:not started] - **Built In** — Add Built In scraper (builtin.com/jobs)
- [ |status:not started] - **Work at a Startup** — Add Y Combinator's Work at a Startup scraper (workatastartup.com)
- [ |status:not started] - **Braintrust** — Add Braintrust scraper (app.usebraintrust.com/jobs/?role=3)
- [ |status:not started] - **Authentic Jobs** — Add Authentic Jobs scraper (authenticjobs.com)
- [ |status:not started] - **We Work Remotely** — Add We Work Remotely design jobs scraper (weworkremotely.com)
- [ |status:not started] - **Manually Add Jobs** — Let the user paste a job link and manually fill in company, role, URL, and posting date/age

---

### Initiative: Security Hardening

- [ |status:not started] - **Rotate API Keys & Scrub Git History** — Real Adzuna + RapidAPI keys in `.env`; rotate credentials, move to `.env.local`, scrub from git history _(audit: critical)_
- [ |status:not started] - **Security Headers Middleware** — Add CSP, HSTS, X-Frame-Options via `headers()` in `next.config.mjs` _(audit: medium)_
- [ |status:not started] - **Address npm Audit Vulnerabilities** — 12 vulnerabilities (hono + lodash via chevrotain/prisma-ast); run `npm audit fix` or pin patched versions _(audit: medium)_
- [ |status:not started] - **Dockerfile: Add Non-Root User** — Add explicit `USER node` directive before CMD _(audit: medium)_

---

### Initiative: Code Health

- [ |status:not started] - **Extract Shared Multi-Source Scraper** — Greenhouse and Lever functions are ~88 lines of near-identical code; refactor into a single `runMultiSourceScraper()` helper _(audit: high)_
- [ |status:not started] - **Code Redundancy Cleanup** — Score fields constant defined 3×, salary parsing duplicated in companies/page.tsx, company upsert duplicated in scraper-orchestrator, slug capitalization duplicated in greenhouse/lever _(audit: medium)_
- [ |status:not started] - **Remove Dead Code** — Delete unused `runScrape()` action in `actions.ts` and `lib/scraper-orchestrator.ts` if confirmed unused _(audit: medium)_
- [ |status:not started] - **Add Input Validation to Server Actions** — Max-length on search terms/notes, status enum allowlist in `setJobStatus()` _(audit: medium)_
- [ |status:not started] - **Audit Cleanup — Minor Issues** — Unused imports/state in JobsTable, unused function in uiuxjobsboard, unused font in layout, boilerplate metadata, commented slugs, `description` field decision, raw px/rem in CSS, missing eli5 comments, scraper error handling consistency

---

### Initiative: UX Polish Pass 2

- [ |status:not started] - **Color Palette Update** — Reconcile old purple/pink palette to new blue/neutral theme tokens; fix button + link colors
- [ |status:not started] - **Header Layout Cleanup** — Clean up header spacing and layout
- [ |status:not started] - **Job Type Column** — Separate column for type; label on xl desktops, tooltip on smaller screens
- [ |status:not started] - **Spacing Tokens Pass** — Audit and fix spacing/layout across the app using token system
- [ |status:not started] - **Terminal Modal Styling** — Tune icon sizes, spacing, colors, and layout
- [ |status:not started] - **Location Column Fix** — Location icon in its own cell; ellipsize long locations with tooltip
- [ |status:not started] - **Search Jobs Button State** — Disable instead of hide when no roles are being searched
- [ |status:not started] - **Last Search Timestamp** — Show "x hours since last job search" on jobs page
- [ |status:not started] - **Color Accessibility Audit** — Full WCAG audit of color usage across the app
- [ |status:not started] - **Save UX Friction** — Saving currently has min 2s loading animation (intentional); revisit whether this is still the right call
- [ |status:not started] - **Remove Remotive** — Remove the Remotive scraper

---

## Backlog

- [ |status:not started] - **Aggregator Site Passthrough** — Many results link through aggregator sites instead of the actual company; observe more real-world examples before implementing. [Investigation notes](docs/investigations/aggregator-sites.md)
