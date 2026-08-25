---
paths: ["lib/scrapers/**", "lib/scraper-save.ts", "lib/scraper-save.test.ts"]
---

# Scrapers — Rules & Conventions

## Architecture

- **Scraper config** — `lib/scrapers/scraper-config.ts` MUST be the single source of truth for which scrapers run and which Greenhouse/Lever slugs are used. Set `enabled: false` to silently skip a scraper.
- **Shared utilities** — New scrapers MUST import from `lib/scrapers/fetch-utils.ts` rather than rolling their own salary parsing, work mode detection, etc.
- **Two scraper patterns** — scrapers MUST use one of two wiring patterns in `scraper-actions.ts`:
  - *Per-search-term* (Adzuna, Dribbble): uses `runSearchTermScraper`, called once per user search term, saves under that term's ID.
  - *System-term* (jSearch, WeLoveProduct, Greenhouse, Lever): collects all user terms itself, runs fixed search logic, saves under a `__name__` system term via `getOrCreateSystemTerm`. MUST use when the scraper needs to combine or transform terms.

## Status Cascade
On save in `scraper-save.ts`, new jobs MUST be auto-classified in order: expired (≥8 days old) → too far (`classifyLocation`) → backlog. On page load, `expireOldBacklogJobs()` also expires any backlog jobs that aged out. In-progress statuses (anything beyond backlog) MUST NOT be auto-expired.

## Dedup Replaceable Statuses
`REPLACEABLE_STATUSES` in `lib/scraper-save.ts` controls which job statuses can be overwritten when a duplicate posting is found (same company + title, different URL). MUST update this set whenever a new status is added — decide whether it's "safe to replace" or "sacred" (in-progress jobs that MUST NOT be clobbered).

## System SearchTerms
Scrapers that aren't keyword-based (e.g. Greenhouse, Lever) MUST link their jobs to an auto-created system SearchTerm using `getOrCreateSystemTerm(name)` from `lib/scraper-save.ts`. These terms are prefixed with `__` (e.g. `__greenhouse__`) and MUST NOT be shown in the UI.

System terms MUST be filtered in JavaScript, not via Prisma query. The libsql adapter does not support Prisma's `startsWith` filter. Use:

```ts
terms.filter((t) => !t.query.startsWith("__"));
```

## Conventions

- **`salaryRange`** — MUST use `"?"` when salary is unknown (MUST NOT use empty string). When known, MUST format as abbreviated `$XXX-$XXXk` (e.g. `$178-$241k`). See `formatSalary()` helpers in other scrapers.
- **`workMode`** values — MUST be one of `"remote"`, `"hybrid"`, `"in-person"`, or `""` (unknown). MUST NOT use `"onsite"`.

## Playwright scrapers: two-pass pattern

When a listing page lacks structured data (dates, salary, work mode), MUST use a two-pass approach:

1. Collect job stubs (title, company, url) from the listing pages
2. Filter by query first to avoid unnecessary page loads
3. Visit each matched job's detail page and parse `<script type="application/ld+json">` for accurate `datePosted`, `baseSalary`, `jobBenefits`, `jobLocationType`

WeLoveProduct uses this pattern — see `weloveproduct.ts` for reference.

## Adding a New Scraper

1. MUST create `lib/scrapers/<name>.ts` — export a function returning `ScrapedJob[]` (see `types.ts`)
2. MUST use `fetchWithTimeout` from `lib/scrapers/fetch-utils.ts` for all HTTP calls (15s default timeout, human-readable errors)
3. MUST add a server action in `app/scraper-actions.ts`
4. MUST register the scraper in `components/ScraperModal.tsx`

## Playwright scrapers: verify output before shipping

After implementing a Playwright scraper, MUST run it against real data and manually verify every field in the returned jobs:

- **title** — MUST match the actual job title on the site
- **companyName** — MUST be the real hiring company (MUST NOT be the aggregator site name)
- **url** — MUST link directly to the job posting
- **location** — MUST be city/region, MUST NOT be empty or garbled
- **workMode** — MUST be `"remote"`, `"hybrid"`, `"in-person"`, or `""`
- **firstPublished** — MUST be a real date, MUST NOT be `new Date()` fallback for all jobs
- **salaryRange** — MUST be `"?"` if unknown, formatted correctly if known

MUST NOT ship until all fields have been spot-checked on a real scrape run.
