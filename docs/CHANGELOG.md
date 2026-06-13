# Changelog

<!-- Newest at top -->

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
