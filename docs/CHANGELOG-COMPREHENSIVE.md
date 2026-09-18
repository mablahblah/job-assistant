# Comprehensive Changelog

<!-- Newest at top -->

## September 18, 2026 - v1.0.0

### New Features

#### One Command for a Whole Job Search

A job search used to be a sequence you drove by hand, one command at a time, remembering which step came next and what it had left half-finished. Now `npm run job-search` runs the whole thing: it clears out jobs that have gone stale, gathers new ones from every source, follows each link back to the employer's own posting, reads that posting, works out whether the job is close enough to you, and saves at every stage. Scoring follows straight after. Because every stage writes to the database before the next one starts, a search interrupted halfway keeps everything it had already finished, and running it again picks up exactly where it stopped rather than starting over.

#### Your Job History Is Recorded and Can Be Asked Questions

You could see the jobs in your backlog, but never how any of them got there, and a job removed as a duplicate vanished without trace. Every job now leaves a record of each thing that happened to it — which source found it, whether its link was followed successfully, whether its posting could be read, whether it matched on location, and why it was dropped if it was. Those records outlive the jobs themselves, so a duplicate that was merged away can still be followed to the job it became. Because each record names the search it belongs to, you can ask which sources actually produce the jobs you apply to, and watch that change over time.

#### Employers You Rate Highly Get Watched Directly

Good employers reached you by luck: an aggregator happened to list one of their jobs, and you happened to see it. Now, when you score an employer well and they post on a hiring site the app can read, they are added to the list of employers it checks directly from the next search onward. You stop depending on a middleman to mention them. Nothing is watched by default — an employer earns it by being scored, so the list only ever grows with employers you have actually judged, and never fills up with ones met once and forgotten.

#### The Same Job from Two Sources Is Recognised as One Job

Two sites listing one job would give you two entries, because they spelled the employer or the title differently — "Acme, Inc." against "Acme", or "Sr. Prod Designer" against "Senior Product Designer". Titles and employer names are now put into a consistent form before anything is compared, and jobs are matched on their links, or on employer and title where the dates agree. What a source actually published is kept untouched alongside, so nothing is lost if the matching rules change later. A job posted again under a fresh date is recognised as the same role rather than a new one, and returns to your backlog instead of staying expired.

#### Jobs Are Judged Against Where You Actually Are

Whether a job was close enough used to be decided by comparing place names, which meant a remote job open to all of Texas could be missed while a job in a same-named town two states away slipped through. Your location is now a postcode and a distance, and every job's locations are tested against them by actual geography. A remote job matches if the place it is open to contains you — Texas does, and so does the United States — or if it is inside your distance. Every location a job lists is paired against every way of working it offers, so a job open to several places gets every chance to match.

### Improvements

- **Dashboard** Jobs whose link could not be followed, or whose posting could not be read, now appear in their own list rather than silently disappearing, so the dashboard is where you go to fix them.
- **Dashboard** The reasoning behind a score now appears when you hover that score, so a job's reasoning and an employer's reasoning are each reachable from the number they explain.
- **Dashboard** A job's total score is hidden once you have applied or ruled it out, where it no longer informs anything, while the ratings behind it stay.
- **Dashboard** You see both the date a job was originally posted and the date it was posted again, with the repost marked.
- **Work Log** A work log entry now survives its job being deleted or overwritten, because it keeps its own copy of the employer name and job title. Your Texas filings can no longer be lost to a change in the job behind them.
- **Job Search** A search that hits a problem now says which step stopped it and why, and still reports everything the steps before it finished.
- **Job Search** Sources that turn the app away are now told apart from pages that are genuinely missing. A source refusing one request no longer writes the job off for good — it is tried again on the next search.

### Internal

- **Architecture** The pipeline was rebuilt from scratch on a new database, alongside the old one rather than on top of it. Collectors and parsers are now the only code shaped to fit a particular source; every other step acts on job data alone and cannot tell where a job came from.
- **Architecture** Seven pieces are single shared implementations, identical wherever they are called: removing duplicates, saving and updating, following links, putting names into a consistent form, matching locations, clearing out the backlog, and recording history. A second implementation of any of them is a defect rather than a variation.
- **Architecture** One runner calls each step in order and hands down the database connection, the services, the run identifier and the collection date. Scoring is a runner of its own, asking the database for its own work rather than reading what the first one returned.
- **Structure** Every file in `lib/` now sits in a folder named for the kind of thing it is, and `lib/` holds no file of its own. The map is written down as a rule.
- **Migration** Active jobs, the work log, and the employers behind them moved to the new database — 59 jobs, 70 work log entries and 54 employers, counts verified on both sides. Scores were deliberately left behind so the next scoring run judges everything fresh.
- **Removal** The old pipeline was deleted. Nothing imports it, and a test pins its absence.
- **Testing** The suite grew to 3,362 tests across 166 files. Every step's history-writing has a test file of its own, separate from the tests for what it decides.
- **Safety** The command that rebuilds a database now compares paths by asking the filesystem which file they name, rather than comparing them as text. On a disk that ignores capitalisation, the old check let a differently-spelled path through and the real database would have been deleted.
- **Correctness** A run's report now keeps the failure that stopped it. Cleanup runs afterwards, so a browser that would not shut was overwriting the real cause with itself.
- **Correctness** Matching a job to its employer, and judging an employer for direct watching, now survive one bad record. Previously a single database error threw away every record already finished.
- **Correctness** A refused write that names no blocking employer is now raised rather than reported as an everyday name clash.
- **Collectors** Adzuna now says when a search matched more postings than one page holds, instead of losing the rest silently.
- **Collectors** A search that comes back empty while its siblings find jobs is now named, instead of being hidden behind the searches that worked.
- **Duplication** Five pieces of logic that had been written out more than once were extracted and tested: the failure tracker, command-line option reading, problem-line printing, the database-mismatch check, and reading an employer's name off a hiring page. The failure tracker had already drifted — two of its three copies carried a bug the third did not.
- **Dependencies** Two packages nothing imported were removed. One new package, `tldts`, reads the registrable part of a web address.
- **Cleanup** Four configuration files named a folder that no longer exists; one supported a container build that does not exist. A day in milliseconds was written three ways across five files and is now one shared value.

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
