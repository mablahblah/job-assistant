# Backlog

## Planned Initiatives

### Initiative: Smarter Auto-Classification

_Goal: Begin makingI n it so the process can run completely autonomously and is token efficient as possible._

- [ ] **Don't treat replaced (repost) jobs as truly new** - See `/docs/search-issues.md` Step 1: Scrape | Replaced dupes inflate new job count for details.
- [ ] **Batch command for Title mismatches** - - See `/docs/search-issues.md` Step 2: Scrape | Title mismatch flagging is slow — no batch CLI command for details.
- [ ] **Batch command for Alignment scoring** - - See `/docs/search-issues.md` Step 2: Scrape | Alignment scoring is slow — no batch CLI command for details.

---

### Initiative: More Data Sources

_Goal: Broaden job coverage by adding new scraper sources._

- [ |status:not started] - **Behance Jobs** — Add Behance job board scraper (behance.net/joblist?category=ui-ux-design)
- [ |status:not started] - **Wellfound** — Add Wellfound scraper (wellfound.com)
- [ |status:not started] - **Built In** — Add Built In scraper (builtin.com/jobs)
- [ |status:not started] - **Work at a Startup** — Add Y Combinator's Work at a Startup scraper (workatastartup.com)
- [ |status:not started] - **Braintrust** — Add Braintrust scraper (app.usebraintrust.com/jobs/?role=3)
- [ |status:not started] - **Authentic Jobs** — Add Authentic Jobs scraper (authenticjobs.com)
- [ |status:not started] - **We Work Remotely** — Add We Work Remotely design jobs scraper (weworkremotely.com)

---

### Initiative: Security Hardening

_Goal: Rotate leaked credentials and lock down secrets management._

- [ |status:not started] - **Rotate API Keys & Scrub Git History** — Real Adzuna + RapidAPI keys in `.env`; rotate credentials, move to `.env.local`, scrub from git history _(audit: critical)_

---

### Initiative: Input Validation & Hardening

_Goal: Add defensive validation to CLI inputs and security headers to the local web server._

- [ |status:not started] - **CLI Input Validation** — Add status enum whitelist, score range bounds (1-5), and minutesAgo bounds to `scripts/cli.ts` _(audit: major)_
- [ |status:not started] - **Security Headers on Local Server** — Add CSP, X-Frame-Options, X-Content-Type-Options middleware to `scripts/serve.ts` _(audit: major)_
- [ |status:not started] - **Inline Style Cleanup** — Replace `style="display: none;"` in `lib/web/render.ts` with a CSS class _(audit: minor)_

---

### Initiative: Code Health

_Goal: Clean up technical debt and dead code._

- [ |status:not started] - **Extract Shared Multi-Source Scraper** — Greenhouse and Lever functions are ~88 lines of near-identical code; refactor into a single `runMultiSourceScraper()` helper _(audit: high)_
- [ |status:not started] - **Code Redundancy Cleanup** — Score fields constant defined 3x, salary parsing duplicated, company upsert duplicated in scraper-orchestrator, slug capitalization duplicated in greenhouse/lever _(audit: medium)_
- [ |status:not started] - **Remove Dead Code** — Delete unused web UI code (Next.js pages, components, server actions, CSS, layouts) now that the app is CLI-only _(audit: high)_

---

## Future/Ideas

_Ideas, bugs, and items not yet tied to an initiative._

- **Remove CLI view commands** — Once the Local Web View fully covers `/view-backlog`, `/view-active-jobs`, and `/view-log` use cases, remove the redundant CLI commands
- **Verify company note is populated during /job-search** — The `note` field (scoring rationale) exists on the Company model and is saved by `saveCompanyScore`, but it's unclear if `/job-search` consistently passes a note when scoring companies. Verify and fix if not — the web view uses it as a tooltip on company names.
