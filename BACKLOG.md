# Backlog

## Planned Initiatives

### 1. Pipeline Accuracy

_Goal: Stop misclassifying good jobs — fix location filtering, deduplication, and date handling so the backlog reflects reality._

- [ ] **Expand AUSTIN_AREA whitelist** — Add missing Austin-metro neighborhoods (bee cave, tarrytown, dessau, bluff springs) that cause jobs to be misclassified as "too far"
- [ ] **Geo-based Location Classification** — Replace the string whitelist with geocoding + radius check. Solves nearby-city misses and Adzuna's unreliable distance filter returning jobs in Fort Worth, NYC, etc.
- [ ] **Dedupe Priority for Greenlit URLs** — Priority system at any dedupe stage to decide which match is saved and which is abandoned
- [ ] **Staged Dedupe** — Dedupe at two stages: post-collection (collected URLs) and post-resolution (resolved URLs against DB, also where repost checking happens)
- [ ] **Set Modified Date on auto-expired and 'too far' Jobs** — Disqualified jobs never appear at top of their list because modified date isn't set during pipeline classification

---

### 2. Repost Handling

_Goal: Correctly identify, store, and resurface reposted jobs so fresh listings don't get buried._

- [ ] **Repost is a boolean flag, not a status** — `auto-classify-jobs` sets `status: "repost"` but the schema has `repost` as a `Boolean` field. Set the boolean flag and leave status unchanged
- [ ] **Smarter repost detection** — Compare dates (incoming `updated_at`/`created_at` vs existing job's dates) to confirm genuinely refreshed posting vs. new role with same title
- [ ] **Re-classify Reposts** — When a repost updates an existing job, re-run auto-classification (location + age). Expired-by-age jobs should return to backlog when reposted fresh
- [ ] **Check-Reposts CLI Subcommand** — Compare today's new jobs against existing jobs by company + title similarity, output matches with confidence score
- [ ] **Greenhouse `first_published` vs `updated_at`** — Parser uses `updated_at` as `postedAt` but Greenhouse refreshes this frequently so old jobs look new. Check both fields; if `first_published` is earlier, auto-flag as repost

---

### 3. Security & Hardening

_Goal: Rotate leaked credentials, lock down inputs, and add security headers._

- [ ] **Rotate API Keys & Scrub Git History** — Real Adzuna + RapidAPI keys in `.env`; rotate credentials, move to `.env.local`, scrub from git history _(audit: critical)_
- [ ] **CLI Input Validation** — Add status enum whitelist, score range bounds (1-5), and minutesAgo bounds to `scripts/cli.ts` _(audit: major)_
- [ ] **Security Headers on Local Server** — Add CSP, X-Frame-Options, X-Content-Type-Options middleware to `scripts/serve.ts` _(audit: major)_
- [ ] **Escape HTML Attribute Fallbacks in Render** — `lib/web/render.ts:33` passes raw `mode` string into a `title` attribute when `workMode` doesn't match known values. Run through `escapeHtml` to close stored XSS path _(audit: minor)_
- [ ] **Inline Style Cleanup** — Replace `style="display: none;"` in `lib/web/render.ts` with a CSS class _(audit: minor)_
- [ ] **Kill docker build process** — Remove failing GitHub Action that triggers on merge to main for an obsolete docker build

---

### 4. Parser & Collector Quality

_Goal: Parse more jobs from more sources, and track quality to know where to invest._

- [ ] **Generic Fallback** — Parse arbitrary HTML for unmatched domains. Failed parsing sets "needs review" status. Includes detecting custom-domain Greenhouse jobs via `gh_jid` and slug discovery. [research](docs/initiatives/reliable-scraping-pipeline/generic-fallback-research.md)
- [ ] **Remaining ATS Parsers** — Workable (22), SmartRecruiters (14), Gem (5), Workday (5), Jobvite (3), DigitalHire (2), ApplyToJob (2), BreezyHR (1), HiBob (1), Oracle/Taleo (1). [spike](docs/initiatives/reliable-scraping-pipeline/identify-common-job-board-urls.md)
- [ ] **Ongoing parser tracking** — Track pipeline results across runs: resolution identifies blacklist/parser candidates, parsing + scoring identifies high-value ATS companies, per-source breakdown through each pipeline stage
- [ ] **Collector Quality Analysis** — Tag jobs by collector source and track resolution success rates to identify which sources produce clean vs dirty results
- [ ] **Greenhouse `company_name` field** — Job API response includes `company_name` directly but parser makes a separate `/v1/boards/{slug}` call. Use the inline field to save one HTTP request per unique company per run

---

### 5. Scoring & Company Intelligence

_Goal: Score the right things, resurface unknowns, and auto-expand coverage for top companies._

- [ ] **Only Score Companies & Jobs in the backlog** — Update `scripts/cli.ts unscored` to only return unscored companies with backlog jobs
- [ ] **Scoped Company Scoring** — Pass specific company names to `/score-companies` instead of fetching all unscored companies
- [ ] **Batch Company Scoring** — `--batch` flag or standalone command to work through unscored companies in chunks outside the pipeline
- [ ] **Re-investigate Company 3s** — Treat dimensions scored 3 (insufficient data) the same as nulls — surface for re-investigation, skip confirmed scores
- [ ] **Auto-Watch High-Scoring ATS Companies** — When a company scores avg >= 4 and has known `atsPlatform`/`atsSlug`, auto-add the slug to the corresponding collector config

---

### 6. Aggregator Handling

_Goal: Make aggregator resolution reliable and self-improving — investigate once, learn for next time._

- [ ] **Reassign-Company CLI Subcommand** — Update a job's company association after resolving an aggregator (e.g. "Staffy" -> "Acme Corp"), creating the new company if needed
- [ ] **Update-Job CLI Subcommand** — Patch a job's scraped fields (url, location, workMode, salaryRange) after investigation
- [ ] **Per-Aggregator Investigation Playbook** — Extend the Aggregator model with an `instructions` field. Save how resolution worked so Claude uses it on future encounters instead of guessing. Update instructions when they prove insufficient on re-encounter
- [ ] **3-Strikes Skip Rule** — Track failed investigation attempts per aggregator. After 3 unresolvable jobs, skip future investigation automatically. Also skip investigation for jobs with alignment <= 1
- [ ] **Auto-Detect Unknown Aggregators** — Heuristic check for aggregator signals (generic titles, domain-matching company names, known job-board URL patterns) and output suspected aggregators for confirmation

---

### 7. Workflow Automation

_Goal: Reduce manual steps in the daily job search workflow._

- [ ] **Add-External CLI Subcommand** — Single command to save an external job with forced "backlog" status, bypassing age-based auto-expire
- [ ] **Fix Auto-Expire for External Jobs** — Prevent `expireJobs()` from re-expiring manually-added jobs
- [ ] **Find-by-Company CLI Subcommand** — Look up jobs by company name for repost checks without raw Prisma queries
- [ ] **Compact Scrape Summary** — Print a compact summary line to stderr so the pipeline can read results directly without extra parsing commands
- [ ] **Email Job Alert Pipeline** — Use Gmail MCP to collect job links from emails with specific labels during job search, run through parser, archive emails

---

### 8. More Data Sources

_Goal: Broaden job coverage by adding new collector sources._

- [ ] **Behance Jobs** — behance.net/joblist?category=ui-ux-design
- [ ] **Built In** — builtin.com/jobs
- [ ] **Work at a Startup** — Y Combinator's workatastartup.com
- [ ] **We Work Remotely** — weworkremotely.com design jobs
- [ ] **Wellfound** — wellfound.com

---

### 9. Dashboard & Web View

_Goal: Surface more useful information in the web UI._

- [ ] **Visual repost indicator** — Badge/icon on jobs with the `repost` flag so reposted listings are distinguishable at a glance
- [ ] **Repost score penalty** — `repostModifier` in `calculateScore` that reduces score for reposts so fresh posts rank higher (stellar scores still surface)
- [ ] **Score breakdown tooltip** — Tooltip on score column showing each dimension's raw value and weight, plus age and salary multipliers
- [ ] **Remove CLI view commands** — Once the web view fully covers backlog, active, and log use cases, remove redundant CLI commands
- [ ] **Verify company note is populated** — Confirm `/job-search` consistently passes a note when scoring companies; the web view uses it as a tooltip

---

### 10. Code Health

_Goal: Clean up technical debt and dead code._

- [ ] **Extract Shared Multi-Source Scraper** — Greenhouse and Lever functions are ~88 lines of near-identical code; refactor into `runMultiSourceScraper()` helper
- [ ] **Code Redundancy Cleanup** — Score fields constant defined 3x, salary parsing duplicated, company upsert duplicated, slug capitalization duplicated, "no search terms" guard duplicated 3x
- [ ] **Remove Dead Code** — Delete unused web UI code (Next.js pages, components, server actions, CSS, layouts), unused exports (`createPrismaClient`, `safeJson`, url-resolver internals, `generateWeekSlots`, `parseEnrichmentFlags`, `addScores` in serve.ts), orphaned config entries, commented-out slugs
- [ ] **Cleanup script deletes scored companies** — `cleanup-db.ts` deletes "orphaned" companies, destroying scores and enrichment data. Skip companies with scores/enrichment, or soft-delete
- [ ] **Remove Legacy Scrapers** — Delete `lib/scrapers/`, `lib/scraper-save.ts`, `lib/scraper-runner.ts`, `scripts/scrape.ts`, and `.claude/rules/scrapers.md`. The collector/parser/pipeline architecture fully replaces scrapers
- [ ] **Small fixes** — Composite index on `(atsPlatform, atsSlug)`, pre-existing lint errors, convention drift (incorrect comment in scraper-config.ts, import alias in serve.ts)

---

## Future/Ideas

_Items not yet tied to an initiative._

- **Auto-enrich on work log entry** — When `/change-status` triggers a work search log entry, automatically run enrichment for that job's company if not yet enriched
- **Braintrust** — app.usebraintrust.com/jobs/?role=3
- **Authentic Jobs** — authenticjobs.com
- **Hiring Cafe** — hiringcafe.com
