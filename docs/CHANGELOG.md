# Changelog

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

## July 17, 2026 - v0.3.0

### New Features

#### Export Parsable PDF Resume

Applying to a job means tailoring your resume to the posting — slow, repetitive work. You can now run `/generate-resume [company] [role]` against jobs you've already collected. It reads the posting's description, picks the most relevant material from your resume inventory, and walks you through a section-by-section rationale — title, summary, bullets, skills, and tools — before anything is generated. Once you approve, it exports a correctly-named, ATS-parsable PDF ready to submit. If the posting's link is dead, it tells you and offers to retry, mark the job expired, or work from pasted page content instead.

### Fixes

- **Work Search Log** Work search log entries are no longer lost when the job database is rebuilt, and entries previously lost to a schema change have been restored

## June 12, 2026 - v0.2.0

### New Features

#### Dual Date Model

Some job boards reset a posting's date every time the employer makes an edit, making months-old jobs look brand new. Jobs now track two dates — when the job was originally posted and when it was last refreshed — so the age shown in the dashboard reflects reality. Scoring and auto-expiry use the original date, and reposted jobs are visually tagged.

### Improvements

- **Dashboard** Reposted jobs show an "RP" badge with a tooltip displaying when the job was reposted
- **Job collection** Dribbble, UIUXJobsBoard, and WeLoveProduct now capture approximate posting dates from age labels like "3 days ago" instead of discarding them
- **Job collection** If a job is later found on a better source with an older original date, the displayed age updates to reflect the real posting date

### Fixes

- **JSearch** Jobs without a date from the API now show the date they were collected instead of pretending they were posted today

## v0.1.0

### New Features

#### Job Search Dashboard

A local dashboard for tracking job postings across multiple sources. Jobs are displayed in a scored, ranked table with columns for company, role, location, work mode, salary, posting date, and status. The dashboard is responsive across phone, tablet, and desktop.

#### Multi-Source Job Collection

Jobs are automatically collected from seven sources: Adzuna, JSearch, Greenhouse, Lever, Dribbble, WeLoveProduct, and UIUXJobsBoard. API-based sources pull structured data directly. Browser-based sources visit job listing pages, scroll through results, and visit individual job detail pages for accurate information. All sources run in parallel during a collection.

#### Job Scoring & Ranking

Each job receives a composite score based on four company-level dimensions (employee satisfaction, customer satisfaction, work/life balance, political alignment), a per-job alignment rating, salary proximity to a target, and posting age. Fresher jobs get a small boost, and scores decay gradually after three days. Jobs are ranked by score so the best matches appear first.

#### Company Research & Scoring

Companies are scored on four dimensions using a 1–5 scale. An export button generates a prompt listing unscored companies with a representative job link. After researching, scores and notes are imported back. Notes appear as tooltips on company names throughout the dashboard.

#### Automatic Job Classification

Jobs are automatically sorted into statuses on collection. Jobs with locations too far away are marked "too far." Jobs older than eight days are marked "expired." The remaining jobs land in the backlog for review. Location classification uses geocoding to determine distance, with configurable rules for which areas to allow or block.

#### Job Management

Jobs move through a status pipeline: backlog, app. sent, screening, interview, test, and offer. Each status has a distinct icon and color. Jobs can be deleted individually, and deleted job URLs are remembered so the same posting isn't collected again.

#### Dashboard Organization

The dashboard is split into three tabs — Backlog (ranked by score), Active (sorted by pipeline stage), and Disqualified (expired, too far, rejected, won't apply). Company scores can be filtered by "has jobs," "active jobs," and "missing scores."

#### Work Search Activity Log

A log of job search activities for unemployment reporting. Each entry records the date, company, job title, and activity type. Company contact details (address, phone, website) are automatically looked up and filled in.

#### Reliable Collection Pipeline

Job collection follows a structured pipeline: collect from sources, remove duplicates, resolve shortened or redirected URLs to find the original posting, parse detailed information from the original source, remove duplicates again using the parsed data, classify by location, and save. Each step is independent and testable.

### Improvements

- **Dashboard** Responsive layout adapts columns and content at four breakpoints — score columns collapse to an average on smaller screens, location shows as an icon with tooltip, status shows as icon-only
- **Dashboard** Avenir Next system font with responsive sizing
- **Job collection** Greenhouse and Lever each support multiple company boards running in parallel
- **Job collection** JSearch runs two searches per collection — one for remote jobs and one for Austin-area jobs — to maximize coverage within API limits
- **Scoring** Salary influences ranking — jobs paying above target get a boost, below target get a penalty, and unknown salaries are neutral
- **Deduplication** When the same job appears from multiple sources, the version from the most reliable source wins. Jobs already being applied to are never overwritten.
- **Security** API credentials removed from git history; CLI inputs validated at all boundaries

### Superseded by CLI Migration

_The following items were built for an earlier web UI that was replaced by CLI commands. They are no longer part of the application._

- Security headers middleware, Dockerfile non-root user, server action input validation, UX polish pass, aggregator site passthrough, enrichment modal, terminal font styling, repost status marking

## Completed Feature Specs

- [Work Search Activity Log](features/work-search-log/work-search-log-spec.md)
- [First Pass Improvements](features/first-pass-improvements/first-pass-improvements-spec.md)
- [Smarter Auto-Classification](features/smarter-auto-classification/smarter-auto-classification-spec.md)
- [Pipeline Accuracy](features/pipeline-accuracy/pipeline-accuracy-spec.md)
- [Reliable Scraping Pipeline](features/reliable-scraping-pipeline/reliable-scraping-pipeline-spec.md)
- [Security: Critical Fixes](features/security-critical-fixes/security-critical-fixes-spec.md)
- [Dual Date Model](features/dual-date-model/dual-date-model-spec.md)
