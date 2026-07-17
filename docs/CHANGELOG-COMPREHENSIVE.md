# Comprehensive Changelog

<!-- Newest at top -->

## July 17, 2026 - v0.3.0

### New Features

#### Export Parsable PDF Resume

Applying to a job means tailoring your resume to the posting — slow, repetitive work. You can now run `/generate-resume [company] [role]` against jobs you've already collected. It reads the posting's description, picks the most relevant material from your resume inventory, and walks you through a section-by-section rationale — title, summary, bullets, skills, and tools — before anything is generated. Once you approve, it exports a correctly-named, ATS-parsable PDF ready to submit. If the posting's link is dead, it tells you and offers to retry, mark the job expired, or work from pasted page content instead.

### Fixes

- **Work Search Log** Work search log entries are no longer lost when the job database is rebuilt, and entries previously lost to the dual-date migration have been restored

### Internal

- **Schema** `WorkSearchEntry` foreign key changed from `CASCADE` to `RESTRICT` on delete, so rebuilding the Job table no longer cascades away TWC records
- **Scripts** Added a backfill script to recreate the lost entries; `TRIGGER_STATUS_MAP` is now exported from its canonical module and imported by the backfill instead of duplicated
- **Serve** Serve skill reads start/stop commands and port from a gitignored `.serve.json`; dashboard port configurable via the `PORT` env var (default 3000); removed the redundant in-repo serve skill
- **Docs** Added company research notes; restructured backlog and renamed r&d files; logged audit findings

## June 18, 2026 - v0.2.1

### Internal

- **Scripts** Removed one-time `cleanup-db.ts` script — its "orphaned company" deletion violated the company persistence rule and the script had already served its purpose

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
