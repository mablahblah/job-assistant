# Scrapers — Rules & Conventions

## Architecture

- **Scraper config** — `lib/scrapers/scraper-config.ts` is the single source of truth for which scrapers run and which Greenhouse/Lever slugs are used. Set `enabled: false` to silently skip a scraper.
- **Shared utilities** — `lib/scrapers/fetch-utils.ts` is the single shared utility layer for all scrapers. New scrapers should import from here rather than rolling their own salary parsing, work mode detection, etc.
- **Two scraper patterns** — scrapers are wired up in one of two ways in `scraper-actions.ts`:
  - *Per-search-term* (Adzuna, Dribbble): uses `runSearchTermScraper`, called once per user search term, saves under that term's ID.
  - *System-term* (jSearch, WeLoveProduct, Greenhouse, Lever): collects all user terms itself, runs fixed search logic, saves under a `__name__` system term via `getOrCreateSystemTerm`. Use when the scraper needs to combine or transform terms.

## Status Cascade
On save in `scraper-save.ts`, new jobs are auto-classified in order: expired (≥8 days old) → too far (`classifyLocation`) → backlog. On page load, `expireOldBacklogJobs()` also expires any backlog jobs that aged out. In-progress statuses (anything beyond backlog) are never auto-expired.

## Dedup Replaceable Statuses
`REPLACEABLE_STATUSES` in `lib/scraper-save.ts` controls which job statuses can be overwritten when a duplicate posting is found (same company + title, different URL). Update this set whenever a new status is added — decide whether it's "safe to replace" or "sacred" (in-progress jobs that must never be clobbered).

## System SearchTerms
Scrapers that aren't keyword-based (e.g. Greenhouse, Lever) must link their jobs to an auto-created system SearchTerm using `getOrCreateSystemTerm(name)` from `lib/scraper-save.ts`. These terms are prefixed with `__` (e.g. `__greenhouse__`) and are never shown in the UI.

**Important:** Always filter system terms in JavaScript, not via Prisma query. The libsql adapter does not support Prisma's `startsWith` filter. Use:

```ts
terms.filter((t) => !t.query.startsWith("__"));
```

## Conventions

- **`salaryRange`** — use `"?"` when salary is unknown (never empty string). When known, format as abbreviated `$XXX-$XXXk` (e.g. `$178-$241k`). See `formatSalary()` helpers in other scrapers.
- **`workMode`** values — `"remote"`, `"hybrid"`, `"in-person"`, or `""` (unknown). Do not use `"onsite"`.

## Playwright scrapers: two-pass pattern

When a listing page lacks structured data (dates, salary, work mode), use a two-pass approach:

1. Collect job stubs (title, company, url) from the listing pages
2. Filter by query first to avoid unnecessary page loads
3. Visit each matched job's detail page and parse `<script type="application/ld+json">` for accurate `datePosted`, `baseSalary`, `jobBenefits`, `jobLocationType`

WeLoveProduct uses this pattern — see `weloveproduct.ts` for reference.

## Adding a New Scraper

1. Create `lib/scrapers/<name>.ts` — export a function returning `ScrapedJob[]` (see `types.ts`)
2. Use `fetchWithTimeout` from `lib/scrapers/fetch-utils.ts` for all HTTP calls (15s default timeout, human-readable errors)
3. Add a server action in `app/scraper-actions.ts`
4. Register the scraper in `components/ScraperModal.tsx`

## Playwright scrapers: verify output before shipping

After implementing a Playwright scraper, run it against real data and manually verify every field in the returned jobs:

- **title** — matches the actual job title on the site
- **companyName** — the real hiring company (not the aggregator site name)
- **url** — links directly to the job posting
- **location** — city/region, not empty or garbled
- **workMode** — `"remote"`, `"hybrid"`, `"in-person"`, or `""` (not wrong)
- **postedAt** — a real date, not `new Date()` fallback for all jobs
- **salaryRange** — `"?"` if unknown, formatted correctly if known

Do not ship until all fields have been spot-checked on a real scrape run.
