# Scrapers — Rules & Conventions

## System SearchTerms

Scrapers that aren't keyword-based (e.g. Greenhouse, Lever) must link their jobs to an auto-created system SearchTerm using `getOrCreateSystemTerm(name)` from `lib/scraper-save.ts`. These terms are prefixed with `__` (e.g. `__greenhouse__`) and are never shown in the UI.

**Important:** Always filter system terms in JavaScript, not via Prisma query. The libsql adapter does not support Prisma's `startsWith` filter. Use:
```ts
terms.filter(t => !t.query.startsWith("__"))
```

## Adding a New Scraper

1. Create `lib/scrapers/<name>.ts` — export a function returning `ScrapedJob[]` (see `types.ts`)
2. Use `fetchWithTimeout` from `lib/scrapers/fetch-utils.ts` for all HTTP calls (15s default timeout, human-readable errors)
3. Add a server action in `app/scraper-actions.ts`
4. Register the scraper in `components/ScraperModal.tsx`
