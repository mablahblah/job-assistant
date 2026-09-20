# Job Search Assistant

## Brief

A CLI tool (via Claude Code commands) that automates the Product Designer job search: scraping jobs from multiple boards, scoring and tracking them, with a local web dashboard for viewing results.

## Problem

Manually checking many job boards is slow and repetitive. No single tool surfaces and prioritizes Product Design roles well, or connects job discovery to application preparation.

## Vision

A personal dashboard that surfaces best-fit jobs automatically, tracks application status, and helps prepare tailored application materials — so the job search becomes a short daily task, not a full-time job.

## Scope

### MPP (Minimum Personal Product)

**MPP Goal:** Working locally on UNRAID — scrape jobs from major boards, score them automatically, track status through the pipeline, and generate application materials via Claude + Figma.

#### Stories

- As a user, I can run scrapers to pull new job postings from multiple boards into a unified list
- As a user, I can see jobs scored and ranked by fit so I can decide what to apply to quickly
- As a user, I can track each job through a status pipeline (backlog → applied → interviewing, etc.)
- As a user, I can score companies so their jobs surface higher or lower in rankings
- As a user, status changes auto-log TWC-compliant work search entries so I can fill out my weekly unemployment form without manual tracking
- As a user, company contact info (address, phone, website) is auto-enriched when I first engage with a job, pre-filling the work search log

## Assets

- Local web dashboard (`npx tsx scripts/serve.ts`) — read-only HTML view for backlog, active jobs, disqualified jobs, and work log

## Documentation

- [CURRENT-FEATURE.md](CURRENT-FEATURE.md) — Active feature
- [CHANGELOG.md](CHANGELOG.md) — Completed features
- [First Pass Improvements](features/first-pass-improvements/first-pass-improvements-spec.md) — Feature (shipped): auto-expire, web view, external jobs
- [Smarter Auto-Classification](features/smarter-auto-classification/smarter-auto-classification-spec.md) — Feature (shipped): repost dedup, batch updates, separated search skills
- [Reliable Scraping Pipeline](features/reliable-scraping-pipeline/reliable-scraping-pipeline-spec.md) — Feature (shipped): zero misclassified jobs from known boards
- [Pipeline Accuracy](features/pipeline-accuracy/pipeline-accuracy-spec.md) — Feature (shipped): fix location filtering and deduplication
- [Security: Critical Fixes](features/security-critical-fixes/security-critical-fixes-spec.md) — Feature (shipped): rotate leaked credentials and lock down external-facing inputs
- [Dual Date Model](features/dual-date-model/dual-date-model-spec.md) — Feature (shipped): honest job dates with firstPublished + repostedAt
- [Smarter Aggregator Handling](features/smarter-aggregator-handling/smarter-aggregator-handling-spec.md) — Feature (planned): reliable aggregator resolution

- [Technical Documentation](tech/table-of-contents.md) — Implementation-level docs: tech stack, views, styling, app functionality, testing, skills

## Notes

- Runs locally as a CLI tool via Claude Code commands
- SQLite via libsql adapter (not standard Prisma SQLite) — `startsWith` filter not supported, must filter system terms in JavaScript
- System search terms prefixed with `__` (e.g. `__greenhouse__`) are never shown in the UI
