# Roadmap

Completed initiatives are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## _CURRENT_: Reliable Scraping Pipeline

_Goal: Zero misclassified jobs reach the backlog from known job boards, and generic-parsed jobs are flagged as lower confidence._

- [x] **Separate Listing Collection from Detail Parsing** — Refactor scrapers into two stages: collect URLs, then parse through tiered parsers
- [x] **Identify Common Job Board URLs** — Research spike: discover real hosting domains behind aggregator links to prioritize greenlit parsers
- [x] **Blacklist URL List** — Domain/URL pattern blacklist to skip known-bad sources before processing.
- [x] **Routing System + Ashby Parser** — Build resolve → route → parse pipeline, validate end-to-end with Ashby (Playwright-based, no API shortcut). Dry-run only.
- [x] **Production Pipeline Integration** — Wire pipeline into `/job-search` and `/add-external-job`, connect `collectAll()`, save to DB, gracefully handle unparsed jobs. New parsers plug in via registry with no pipeline changes. Retires old scraper pipeline.
- [x] **Dedupe after Collection** - Check originalURL list of existing jobs in db before resolution, and toss any search results which match exactly to avoid parsing.
- [x] **Greenhouse & Lever Parsers** — API-based parsers with shared field mappers, ParserFn signature refactor, company name caching via DB, confidence comparison wiring, and Adzuna env var fix. [Spec](docs/initiatives/reliable-scraping-pipeline/greenhouse-lever-parsers.md)
- [x] **Define search terms in single location and use them in each collector**
- [x] **Adzuna Parser** — Pass-through parser for aggregator with no per-job API. Adzuna URLs skip resolution (greenlit), parser returns empty fields, pipeline saves with collector data at medium confidence. Source gate prevents cross-collector misuse. Validation revealed low-quality collector data (see tech debt). [Spec](docs/initiatives/reliable-scraping-pipeline/adzuna-parser.md)
- [x] **Dribbble Parser** — First "Static HTML fetch" parser. Extracts all fields from server-rendered HTML (inline script data > JSON-LD > description text). No Playwright needed. Discovered 4th locationType value (`remote_only`) during live validation. [Spec](docs/
- [x] **Unify Greenlit Matching** — Extract single domain-matching utility used by both pre-resolution shortcut and post-resolution router. Fixes `job-boards.greenhouse.io` routing bug (~10 jobs/run lost). Retires `GREENLIT_DOMAINS` array. [Spec](docs/initiatives/reliable-scraping-pipeline/unify-greenlit-matching.md)
- 🔥 [x] **Log Parse Failures** — Pipeline silently drops failed parses. Capture URL, parser name, and error message for each failure. Include in pipeline log JSON under a `failures` array so we can diagnose and fix parser issues. [Spec](docs/initiatives/reliable-scraping-pipeline/log-parse-failures.md)
- [x] **Narrow API Searches** — Title-only matching, salary floor, date cap, separate remote + Austin calls per search term. Excludes known aggregators (Jobgether) via `what_exclude`. Added Bee Cave to Austin area. [Spec](docs/initiatives/reliable-scraping-pipeline/narrow-adzuna-searches.md)
- 🔥 [x] **More directed collecting on playwright collectors** — All three Playwright collectors (WeLoveProduct, Dribbble, UIUXJobsBoard) rewritten to use each site's search/filter tools with 8-day age cutoff. Shared `parseAgeToDays` utility. Category matching for UIUXJobsBoard. [Spec](docs/initiatives/reliable-scraping-pipeline/directed-collecting.md)
- [x] **Empty WorkMode Classification** — `classifyLocation` now treats empty workMode the same as remote (falls through to keyword check instead of Austin-area-only check). Jobs with empty workMode + remote-signal locations (e.g. "US", "Remote") land in backlog instead of "too far." [Spec](docs/initiatives/reliable-scraping-pipeline/empty-workmode-classification.md)
- 🔹 [ ] **Expand AUSTIN_AREA whitelist** — `lib/location.ts` only has austin, round rock, cedar park, pflugerville. Missing Austin-metro neighborhoods that appear in Adzuna/Dice results: bee cave, tarrytown, dessau, bluff springs. 10 jobs misclassified as "too far" because of this. Quick fix — just add them to the array. (Separate from the long-term Geo-based Location Classification backlog item.)
- 🔥 [ ] **Re-classify Reposts** — When a repost updates an existing job, re-run auto-classification (location + age). A job that expired due to age should return to backlog when reposted with a fresh date. Same for "too far" jobs reposted with updated location/work mode.
- 🔥 [ ] **Generic Fallback** — Parse arbitrary HTML for unmatched domains. Failed parsing → "needs review" status. Includes detecting custom-domain Greenhouse jobs via `gh_jid` and attempting slug discovery (embed `for=` param, JSON-LD company name). [spike](docs/initiatives/reliable-scraping-pipeline/identify-common-job-board-urls.md) [gh research](docs/initiatives/reliable-scraping-pipeline/generic-fallback-research.md)

- 🔹 **Reamining ATS Parsers:** Workable (22), SmartRecruiters (14), Gem (5), Workday (5), Jobvite (3), DigitalHire (2), ApplyToJob (2), BreezyHR (1), HiBob (1), Oracle/Taleo (1) - [spike](docs/initiatives/reliable-scraping-pipeline/identify-common-job-board-urls.md)
- 🔹 [ ] **Dedupe Priority for Greenlit URLs** — At any stage where we check for duplicates, create a priority system to handle which match is saved and which is abandoned.
- 🔹 [ ] **Staged Dedupe** - There are 2 few locations where dedupe can happen: post collection (full list or collected urls), post url resolution (full list of resolved urls). 2nd stage can also be deduped with jobs saved in db AND be when repost checking happens (if same job and same date, dedupe, if same job earlier date, repost)
- 🔹 [ ] **Smarter repost detection** — Current logic matches company + title only. Improve by comparing dates: check the incoming post's `updated_at`/`created_at` against the existing job's dates to confirm it's genuinely a refreshed posting vs. a new role with the same title.
- 🔹 [ ] _NEW_ **Ongoing parser tracking** - Track pipeline results across runs to surface actionable insights: (1) URL resolution identifies new blacklist candidates, (2) URL resolution identifies domains that need parsers, (3) parsing + scoring identifies high-value companies to suggest adding to ATS collectors (uses `atsPlatform`/`atsSlug` data from Greenhouse & Lever Parsers feature), (4) per-source breakdown through each pipeline stage (dedup/resolve/route/parse) so we can see where each collector's jobs end up.

### Known Bugs & Tech Debt

#### Greenhouse Fixes

🔻 - **Greenhouse `company_name` field** — the job API response includes `company_name` directly, but the parser makes a separate `/v1/boards/{slug}` call via the company cache. Using the inline field would save one HTTP request per unique Greenhouse company per pipeline run.
🔻 - **Greenhouse `first_published` vs `updated_at`** — parser currently uses `updated_at` as `postedAt`, but Greenhouse refreshes this field frequently so month-old jobs look brand new (breaks expired classification). Should check both: if `first_published` is earlier than `updated_at`, auto-flag as repost. Consider adding both `firstPublished` and `lastUpdated` fields to the Job model so the web UI can surface repost age.

#### Other

🔻 - **Repost is a boolean flag, not a status** — `auto-classify-jobs` sets `status: "repost"` but the schema has `repost` as a `Boolean` field. The skill should set the boolean flag and leave status unchanged
🔻 - **Composite index on `(atsPlatform, atsSlug)`** — company cache queries `findFirst({ where: { atsPlatform, atsSlug } })` with no index. Table scan is fine at current scale but should add `@@index([atsPlatform, atsSlug])` as Company table grows.
🔻 - **Pre-existing lint errors** — `no-explicit-any` in `lib/parsers/ashby.ts:123` (Playwright `window` cast), 5 unused vars in `pipeline-save.test.ts`. Not introduced by this feature but should be cleaned up.
🔻 - **Stale test fixtures in `pipeline-save.test.ts`** — 2 tests fail because they use a hardcoded `postedAt: "2026-04-20"` that's now >8 days old, triggering auto-expire before location classification runs. Fix: use relative dates (e.g. today minus 2 days) in test fixtures.
🔻 - **Cleanup script deletes scored companies** — `cleanup-db.ts` deletes "orphaned" companies (no remaining jobs), which destroys scores, enrichment data, and ATS metadata. If the company reappears in a future scrape it gets re-created from scratch. Fix: skip deletion of companies that have scores or enrichment data, or soft-delete instead.
🔻 - [ ] **Set Modified Date on auto-expired and 'too far' Jobs** - Disqualified jobs are organized by modified date, but new jobs added to it through our job search pipeline never show up at top.
