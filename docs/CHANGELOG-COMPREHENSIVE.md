# Comprehensive Changelog

<!-- Newest at top -->

## June 12, 2026 - v0.2.0

### New Features

#### Dual Date Model

Replaced the single `postedAt` column with `firstPublished` (original post date, non-nullable) and `repostedAt` (last refresh, nullable). A shared `resolveJobDates()` function pools all known dates — oldest becomes `firstPublished`, newest (if different) becomes `repostedAt`. Scoring age modifier, auto-expiry, and the dashboard all reference `firstPublished`.

### Improvements

- **Dashboard** RP pill rendered inline in date cell when `repostedAt` is set, with relative-date tooltip
- **Collectors** Greenhouse extracts `first_published` + `updated_at`; Lever extracts `createdAt`; Adzuna extracts `created`; JSearch passes empty array instead of fabricating `new Date()`; Playwright scrapers convert relative age strings via `ageToDate()`
- **Parsers** All parsers emit `dates[]` arrays instead of single `firstPublished`; dates flow through `resolveJobDates()` at save time
- **Dedupe** Winner selection uses parser priority only (no date comparison); same-parser DB matches pool dates through `resolveJobDates()`
- **Pipeline** Both collector-save and parser-save paths call `resolveJobDates()`; cross-source retroactive date correction via date pooling on dedupe DB updates

### Fixes

- **JSearch** Empty `job_posted_at_datetime_utc` now produces empty dates array; `resolveJobDates()` falls back to collection date instead of silent `new Date()` fabrication

### Internal

- **Schema** Migration adds `firstPublished`/`repostedAt`, copies `postedAt` data, drops `postedAt` column and `repost` boolean column
- **Shared utils** Added `resolveJobDates()` in `lib/shared-utils/resolve-job-dates.ts` and `ageToDate()` in `lib/collectors/parse-age.ts`
- **Types** `CollectedJob.dates` and `ParsedFields.dates` changed from single `firstPublished: string` to `dates: string[]`/`dates: Date[]`
- **Tests** All `postedAt` references removed; Greenhouse two-date extraction tested in collector and parser
