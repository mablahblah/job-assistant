# Comprehensive Changelog

<!-- Newest at top -->

## September 28, 2026 - v1.4.0

### New Features

#### Jobs on Any Website Are Read

Until now, the app read a job only if it knew that job's website. A job anywhere else was set aside unread, and a job whose reader failed sat in your backlog unread. 143 jobs were stuck like this. A general reader now takes any job the others cannot. It reads what the page publishes for search engines, or else the page's main text, and opens a browser only when a plain read finds neither. It reads the posted and updated dates, work mode, location and description, and leaves title, employer and pay alone. Your source ranking settles any disagreement, with the general reader last. A job whose page is gone is marked expired, though a later step can still return it to your backlog in the same search. A job with no location anywhere is set aside. The 135 set-aside jobs with a link are back in your backlog.

### Internal

- **Packages** Added Mozilla's Readability library, which picks a page's main article out from its menus and footers, so the general reader can read a page's text.
- **Security** The release audit found that job links from job boards can point at your own network, and that the general reader and the link-following step would both open them. The risk is low on your own laptop, because a page is only saved to your local database. A check for both steps is on the backlog.
- **Code** Renamed the code that starts the browser, one helper and several test stand-ins, moved the browser page's shape into its own file, and renamed the stand-in website the tests use, after the release audit flagged them against the naming rule.
- **Tests** Made one test check both of its sample jobs, and pinned another to the summary's current wording.
- **Rules** Split the naming rule into one rule per kind of code, and settled the places where the release audit found the rules' wording unclear.
- **Backlog** Added Dead Postings Stay Expired, Employer Scoring Follows the Job List, Classification Does the Expiring and Descriptions Saved as Plain Text. Added a review of what the trace records to One Shape for Every Summary Block, two repeated-code tasks to Code Health, and the private-address check to Security & Hardening. Filed discovery notes for Forgiving Job Lookup for Resumes.
- **Research** Added notes from a review of your resume.
- **Records** Saved the release audit's report, logged its rule findings, and moved the audit's bookmark to the current commit.

## September 24, 2026 - v1.3.0

### New Features

#### Jobs on Five More Hiring Sites Are Read, and Their Boards Watched

Workable, Gem, SmartRecruiters, BambooHR and Rippling are hiring sites many smaller employers use, and the app could read none of them. Jobs found there were set aside unread, 56 of them by the time this shipped. The app now reads all five, so each job gets its description, location and pay from the employer's own posting, and BambooHR's written pay range is read even without a currency sign. Reading a posting records which board the employer hires through, so an employer you score well has that board checked directly on every later search. Workable's cross-company job search site never names the board, so the app guesses it from the employer's name and keeps a guess only when that board lists jobs. If two hiring sites claim one board name, the search warns you. The 56 set-aside jobs are back in your backlog.

### Internal

- **Security** Updated the installed packages that had a safe fix for a known weakness, taking the package check from 23 problems to 5. The rest need a major upgrade of the database library, now on the backlog.
- **Code** Shared one helper for joining a place's city, state and country, made the new hiring-site names all lowercase like the older ones, and fixed several names and comments, after the release audit flagged them.
- **Tests** Added tests for a failed second page of a SmartRecruiters board, a search stopping once it has enough jobs, reading pay and work mode on Workable's job search site, UltiPro's job number surviving a recovery, and a few rare missing fields. The check that no reader opens a browser now follows what each reader loads, rather than searching its code for a word.
- **Backlog** Filed the release audit's deferred findings under five existing entries.
- **Records** Saved the release audit's report, logged its rule findings, and moved the audit's bookmark to the current commit.

## September 23, 2026 - v1.2.0

### New Features

#### Jobs on Workday and UltiPro Are Read, and Their Boards Watched

Workday and UltiPro are hiring sites many large employers use, and the app could read neither. Jobs found on them were set aside unread, 44 of them by the time this shipped. The app now reads both, so each job gets its description and location from the employer's own posting. Reading a posting also records which Workday or UltiPro board the employer hires through. An employer you score well then has that board checked directly on every later search, page by page, until the matches run out. A board that sends a broken reply no longer stops the boards after it: it is skipped and named in the search's warnings, whichever hiring site it is on. Two UltiPro jobs on one board are no longer mistaken for one. `npm run recover-unparseable-jobs` returns set-aside jobs to your backlog whenever a new reader can claim them, replacing the Greenhouse-only command.

### Internal

- **Code** Moved the UltiPro response shapes into the shared types folder, and renamed two test constants to match the naming rule, after the release audit flagged them.
- **Backlog** Added Smarter Place Matching, after four remote jobs open to you were rejected because a region name was looked up as the wrong place. Cancelled the TheirStack collector and filed discovery notes for four upcoming features and a job-source research report.
- **Skills** Removed an unused skill.
- **Records** Logged the release audit's rule findings and moved the audit's bookmark to the current commit.

## September 20, 2026 - v1.1.0

### New Features

#### Jobs on an Employer's Own Careers Page Are Read

Some employers put their postings on their own website rather than on a hiring site the app recognises. The app decides how to read a posting from the website it sits on, so these matched nothing and were set aside unread — seven of them at last count. Those pages carry a job number from Greenhouse, the hiring platform behind them. The app now reads that number, asks Greenhouse which employer it belongs to, and reads the posting exactly as it reads any other Greenhouse job. Reading one also reveals which Greenhouse board that employer hires through, so an employer you score well is added to the list checked directly from the next search onward. Six employers became eligible that way. The jobs already set aside are not left behind — `npm run recover-greenhouse-jobs` returns them to your backlog once.

### Internal

- **Skills** — The job search and scoring skills now paste the summary a command prints, rather than retelling it in their own words.
- **Backlog** — Split the work on unread jobs into four separate entries, and cancelled two that described work now covered elsewhere.
- **Backlog** — Rewrote the background files for Backlog Expiration & Retention and Repost Handling around what the pipeline actually does, and started a re-cut draft for Collector & Parser Expansion.
- **Records** — Moved the audit's bookmark to the current commit. It had been left at a commit from before the previous feature merged, so every audit since re-covered work already checked. This release's audit was skipped for the same reason.

## September 20, 2026 - v1.0.1

### New Features

#### Jobs Nothing Could Be Read About Are Marked as Unjudged

A job site sometimes refuses the page behind a job, so the search cannot follow the link to the employer's own posting, cannot read that posting, and cannot work out whether the job is near you. The job still stays in your backlog, because the next search will try again. Until now it sat there looking exactly like a job that had been read and scored. Such a job is now called unjudged, and shows a warning marker where its score would be. Pointing at the marker names what is missing: the link not followed, the posting not read, the location not checked, or a job that finished all three and was never scored. A switch above the list hides unjudged jobs, counts them, and remembers your choice for next time.

### Internal

- **Prototypes** — A prototype saved a copy of the live database as a web page and committed it, including real employers, postings and every work log entry. The file is deleted, removed from the project's history, and prototype pages are now ignored so one cannot be committed again.
- **Documentation** — Repaired 61 broken links across the project's documents. Most wrote the "and" symbol in a filename in a form that browsers read differently, so the link missed the file.
- **Backlog** — Trimmed eleven backlog items to one sentence each and moved their detail into background files, six of which are new. Cancelled one item that described the old pipeline's behaviour rather than the current one.
- **Build** — Fixed a type error in a prototype script, which was failing the project's checks.
- **Records** — Corrected the audit's bookmark, which still pointed at a check run before the pipeline rebuild, and recorded the rule violations that release never logged.

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
