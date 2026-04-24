1# Backlog

## Planned Initiatives

### Initiative: More Autonomy & Efficiency

_Goal: ...._

- [ ] - **Only Score Companies & Jobs in the backlog** - Update `scripts/cli.ts unscored` to only score unscored in backlog, and update script in `/score-companies`
- [ |status:not started] - **Add-External CLI Subcommand** — Single command to save an external job with forced "backlog" status, bypassing age-based auto-expire
- [ |status:not started] - **Find-by-Company CLI Subcommand** — Look up jobs by company name for repost checks without raw Prisma queries
- [ |status:not started] - **Scoped Company Scoring** — Pass specific company names to `/score-companies` instead of fetching all unscored companies
- [ |status:not started] - **Fix Auto-Expire for External Jobs** — Prevent `expireJobs()` from re-expiring manually-added jobs
- [ |status:not started] - **Check-Reposts CLI Subcommand** — Compare today's new jobs against existing jobs by company + title similarity, output matches with confidence score; eliminates need for custom temp scripts each run
- [ |status:not started] - **Compact Scrape Summary** — Have `scrape.ts` print a compact summary line to stderr (e.g. `SUMMARY: {"jobsNew":33,"jobsReposted":158}`) so the pipeline can read it directly without 3–4 extra parsing commands. Another idea: dispatch separate agents for each scraper and have each process scores individually.
- [ |status:not started] - **Batch Company Scoring** — Add a `--batch` flag or standalone command to work through the unscored company backlog in chunks outside the pipeline, so unscored companies get addressed on their own schedule

---

### Initiative: Smarter Aggregator Handling

_Goal: Make aggregator resolution reliable and self-improving — investigate once, learn for next time, stop wasting effort on dead ends._

- [ |status:not started] - **Reassign-Company CLI Subcommand** — Update a job's company association after resolving an aggregator (e.g. "Staffy" -> "Acme Corp"), creating the new company if needed
- [ |status:not started] - **Update-Job CLI Subcommand** — Patch a job's scraped fields (url, location, workMode, salaryRange) after investigation reveals the real posting details
- [ |status:not started] - **Per-Aggregator Investigation Playbook** — Extend the Aggregator model with an `instructions` text field. After resolving a job, save how it was resolved (e.g. "real company is in the page footer"). Claude uses these instructions on future encounters instead of guessing.
- [ |status:not started] - **Update Playbook on Re-encounter** — When investigating a returning aggregator, if the saved instructions were insufficient or wrong, update them with what actually worked.
- [ |status:not started] - **3-Strikes Skip Rule** — Track failed investigation attempts per aggregator. After 3 unresolvable jobs from the same aggregator, skip future investigation automatically and leave flagged.
- [ |status:not started] - **Skip Low-Alignment Aggregator Investigation** — After alignment scoring, skip aggregator investigation for jobs with JA <= 1. Only investigate where the title suggests potential alignment.
- [ |status:not started] - **Auto-Detect Unknown Aggregators** — Add heuristic check for aggregator signals (generic titles like "Remote X Jobs in Y", domain-matching company names, known job-board URL patterns) and output suspected aggregators for confirmation and batch-add

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
- [ |status:not started] - **Code Redundancy Cleanup** — Score fields constant defined 3x, salary parsing duplicated, company upsert duplicated in scraper-orchestrator, slug capitalization duplicated in greenhouse/lever, "no search terms" guard duplicated 3× in scraper-runner instead of using existing helpers _(audit: medium)_
- [ |status:not started] - **Remove Dead Code** — Delete unused web UI code (Next.js pages, components, server actions, CSS, layouts) now that the app is CLI-only; also: unused exports (`MIN_WEEKLY_ACTIVITIES`, `parseEnrichmentFlags` in work-search-weeks.ts, `SearchTerm` in types.ts, `ScrapedJob` re-export in adzuna.ts), orphaned `remotive` config entry in scraper-config.ts, commented-out Lever slugs in scraper-config.ts _(audit: high)_
- [ |status:not started] - **Convention Drift Cleanup** — Fix incorrect comment in scraper-config.ts ("enabled: true to skip" → "false"), use `@/` import alias in serve.ts to match other scripts _(audit: minor)_

---

## Future/Ideas

_Ideas, bugs, and items not yet tied to an initiative._

- **Remove CLI view commands** — Once the Local Web View fully covers `/view-backlog`, `/view-active-jobs`, and `/view-log` use cases, remove the redundant CLI commands
- **Visual repost indicator in web view** — Show a visual badge/icon on jobs with the `repost` flag so reposted listings are distinguishable at a glance
- **Verify company note is populated during /job-search** — The `note` field (scoring rationale) exists on the Company model and is saved by `saveCompanyScore`, but it's unclear if `/job-search` consistently passes a note when scoring companies. Verify and fix if not — the web view uses it as a tooltip on company names.
- **Auto-enrich on work log entry** — When `/change-status` triggers a work search log entry (qualifying statuses: `app. sent`, `screening`, `interview`), automatically run enrichment for that job's company if it hasn't been enriched yet. Currently enrichment only runs manually.
