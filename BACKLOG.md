# Backlog

## Planned Initiatives

### Initiative: Repost Handling

_Goal: Correctly identify, store, and resurface reposted jobs so fresh listings don't get buried._

- [ |status:done] - **Repost is a boolean flag, not a status** — Fixed in Staged Dedupe: auto-classify skill no longer sets `status: "repost"`, Dedupe 3 handles repost detection automatically
- [ |status:not started] - **Smarter repost detection** — Compare dates (incoming `updated_at`/`created_at` vs existing job's dates) to confirm genuinely refreshed posting vs. new role with same title
- [ |status:not started] - **Re-classify Reposts** — When a repost updates an existing job, re-run auto-classification (location + age). Expired-by-age jobs should return to backlog when reposted fresh
- [ |status:not started] - **Check-Reposts CLI Subcommand** — Compare today's new jobs against existing jobs by company + title similarity, output matches with confidence score
- [ |status:not started] - **Greenhouse `first_published` vs `updated_at`** — Parser uses `updated_at` as `postedAt` but Greenhouse refreshes this frequently so old jobs look new. Check both fields; if `first_published` is earlier, auto-flag as repost

---

### Initiative: Security & Hardening

_Goal: Clean up remaining minor security and build issues._

- [ |status:not started] - **Escape HTML Attribute Fallbacks in Render** — `lib/web/render.ts:33` passes raw `mode` string into a `title` attribute when `workMode` doesn't match known values. Run through `escapeHtml` to close stored XSS path _(audit: minor)_
- [ |status:not started] - **Inline Style Cleanup** — Replace `style="display: none;"` in `lib/web/render.ts` with a CSS class _(audit: minor)_
- [ |status:not started] - **Kill docker build process** — Remove failing GitHub Action that triggers on merge to main for an obsolete docker build

---

### Initiative: Parser & Collector Quality

_Goal: Parse more jobs from more sources._

- [ |status:not started] - **Generic Fallback** — Parse arbitrary HTML for unmatched domains. Failed parsing sets "needs review" status. Includes detecting custom-domain Greenhouse jobs via `gh_jid` and slug discovery. [research](docs/initiatives/reliable-scraping-pipeline/generic-fallback-research.md)
- [ |status:not started] - **Remaining ATS Parsers** — Workable (22), SmartRecruiters (14), Gem (5), Workday (5), Jobvite (3), DigitalHire (2), ApplyToJob (2), BreezyHR (1), HiBob (1), Oracle/Taleo (1). [spike](docs/initiatives/reliable-scraping-pipeline/identify-common-job-board-urls.md)

---

### Initiative: Scoring & Company Intelligence

_Goal: Score the right things, resurface unknowns, and auto-expand coverage for top companies._

- [ |status:not started] - **Only Score Companies & Jobs in the backlog** — Update `scripts/cli.ts unscored` to only return unscored companies with backlog jobs
- [ |status:not started] - **Scoped Company Scoring** — Pass specific company names to `/score-companies` instead of fetching all unscored companies
- [ |status:not started] - **Batch Company Scoring** — `--batch` flag or standalone command to work through unscored companies in chunks outside the pipeline
- [ |status:not started] - **Re-investigate Company 3s** — Treat dimensions scored 3 (insufficient data) the same as nulls — surface for re-investigation, skip confirmed scores
- [ |status:not started] - **Auto-Watch High-Scoring ATS Companies** — When a company scores avg >= 4 and has known `atsPlatform`/`atsSlug`, auto-add the slug to the corresponding collector config

---

### Initiative: Workflow Automation

_Goal: Reduce manual steps in the daily job search workflow._

- [ |status:not started] - **Add-External CLI Subcommand** — Single command to save an external job with forced "backlog" status, bypassing age-based auto-expire
- [ |status:not started] - **Fix Auto-Expire for External Jobs** — Prevent `expireJobs()` from re-expiring manually-added jobs
- [ |status:not started] - **Find-by-Company CLI Subcommand** — Look up jobs by company name for repost checks without raw Prisma queries
- [ |status:not started] - **Compact Scrape Summary** — Print a compact summary line to stderr so the pipeline can read results directly without extra parsing commands

---

### Initiative: More Data Sources

_Goal: Broaden job coverage by adding new collector sources._

- [ |status:not started] - **Behance Jobs** — behance.net/joblist?category=ui-ux-design
- [ |status:not started] - **Built In** — builtin.com/jobs
- [ |status:not started] - **Work at a Startup** — Y Combinator's workatastartup.com
- [ |status:not started] - **We Work Remotely** — weworkremotely.com design jobs
- [ |status:not started] - **Wellfound** — wellfound.com
- [ |status:not started] - **Braintrust** — app.usebraintrust.com/jobs/?role=3
- [ |status:not started] - **Authentic Jobs** — authenticjobs.com
- [ |status:not started] - **Hiring Cafe** — hiringcafe.com
- [ |status:not started] - **Nextwork** — nextwork career page

---

### Initiative: Dashboard: Score & Repost Display

_Goal: Make scores and repost status more visible and accurate in the web UI._

- [ |status:not started] - **Visual repost indicator** — Badge/icon on jobs with the `repost` flag so reposted listings are distinguishable at a glance
- [ |status:not started] - **Repost score penalty** — `repostModifier` in `calculateScore` that reduces score for reposts so fresh posts rank higher (stellar scores still surface)
- [ |status:not started] - **Score breakdown tooltip** — Tooltip on score column showing each dimension's raw value and weight, plus age and salary multipliers
- [ |status:not started] - **Verify company note is populated** — Confirm `/job-search` consistently passes a note when scoring companies; the web view uses it as a tooltip
- [ |status:not started] - **Hide scores on non-backlog jobs** — Do not show scores on active or disqualified jobs since scores are only relevant for backlog prioritization

---

### Initiative: Dashboard: Job Management & Lifecycle

_Goal: Make the web UI useful for managing jobs through their lifecycle._

- [ |status:not started] - **Show status-set date on active/disqualified jobs** — Display the date the status was last updated instead of the posted date on active and disqualified views
- [ |status:not started] - **Change job status from web view** — Allow updating a job's status directly from the dashboard without using the CLI
- [ |status:not started] - **Remove CLI view commands** — Once the web view fully covers backlog, active, and log use cases, remove redundant CLI commands

---

### Initiative: Code Health

_Goal: Clean up technical debt and dead code._

- [ |status:not started] - **Extract Shared Multi-Source Scraper** — Greenhouse and Lever functions are ~88 lines of near-identical code; refactor into `runMultiSourceScraper()` helper
- [ |status:not started] - **Code Redundancy Cleanup** — Score fields constant defined 3x, salary parsing duplicated, company upsert duplicated, slug capitalization duplicated, "no search terms" guard duplicated 3x
- [ |status:not started] - **Remove Dead Code** — Delete unused web UI code (Next.js pages, components, server actions, CSS, layouts), unused exports (`createPrismaClient`, `safeJson`, url-resolver internals, `generateWeekSlots`, `parseEnrichmentFlags`, `addScores` in serve.ts), orphaned config entries, commented-out slugs
- [ |status:not started] - **Cleanup script deletes scored companies** — `cleanup-db.ts` deletes "orphaned" companies, destroying scores and enrichment data. Skip companies with scores/enrichment, or soft-delete
- [ |status:not started] - **Remove Legacy Scrapers** — Delete `lib/scrapers/`, `lib/scraper-save.ts`, `lib/scraper-runner.ts`, `scripts/scrape.ts`, and `.claude/rules/scrapers.md`. The collector/parser/pipeline architecture fully replaces scrapers
- [ |status:not started] - **Small fixes** — Composite index on `(atsPlatform, atsSlug)`, pre-existing lint errors, convention drift (incorrect comment in scraper-config.ts, import alias in serve.ts), Adzuna collector env var loading (dotenv not loaded when pipeline runs via `npx tsx -e`)

---

## Future/Ideas

_Ideas, bugs, and items not yet tied to an initiative._

- [ |status:not started] - **Auto-enrich on work log entry** — When `/change-status` triggers a work search log entry, automatically run enrichment for that job's company if not yet enriched
- [ |status:not started] - **Set Modified Date on auto-expired and 'too far' Jobs** — Disqualified jobs never appear at top of their list because modified date isn't set during pipeline classification
- [ |status:not started] - **Ongoing parser tracking** — Track pipeline results across runs: resolution identifies blacklist/parser candidates, parsing + scoring identifies high-value ATS companies, per-source breakdown through each pipeline stage
- [ |status:not started] - **Error-Redirect URL Detection** — Detect when a redirect lands on a known error-page pattern (URL contains `?error=true`, bare board slug with no job ID) and mark as failed resolution instead of passing through to routing/parsing
- [ |status:not started] - **Email Job Alert Pipeline** — Use Gmail MCP to collect job links from emails with specific labels during job search, run through parser, archive emails
- [ |status:not started] - **Update Job Posting Data** — Skill to update a job's posting data; if the URL is changed, re-run resolver and parser on the new URL
- [ |status:not started] - **Combine /self-document and /process-search-issues** — /self-document should automatically run /process-search-issues at the end, or merge the two skills
- [ |status:not started] - **Adzuna Remote Work Mode from Search Context** — The Adzuna API has no structured work mode field, and the truncated description often drops "remote". Jobs from the `what: "remote"` collector call can safely default to `workMode: "remote"` since the API confirmed "remote" in the full content. Pass search context into `collectAdzuna` and use it as the default for `detectWorkModeFromText`
- [ |status:not started] - **Early break swallows unknown geo classes on multi-location jobs** — `classify-location.ts:118` breaks on first in-range fragment, skipping later fragments that may have unknown classes
- [ |status:not started] - **Job-search skill understates new job count when held back** — `save.saved` excludes held-back jobs; cosmetic only
- [ |status:not started] - **No test for empty workMode in classify-location** — Falls through to geo classification correctly but no test covers the path
- [ |status:not started] - **Classify-location loop doesn't break early on unresolvable** — Wastes API calls on multi-location jobs when no fragment is in range
- [ |status:not started] - **Unknown class dedup loses per-location context** — Deduplicates by className only; first location's context kept
- [ |status:not started] - **classify-held-back requires all unknown classes resolved** — Could partition and save the classifiable subset while holding back the rest
- [ |status:not started] - **Held-back files accumulate silently** — No detection of unprocessed held-back files from prior pipeline runs
- [ |status:not started] - **Remove spike-helpers directory** — `scripts/spike-helpers/` duplicates `lib/geocoding/haversine.ts` and `prefilter.ts` post-graduation
- [ |status:not started] - **Extract REPLACEABLE_STATUSES constant** — Duplicated in `lib/dedupe.ts` and `lib/scraper-save.ts`
