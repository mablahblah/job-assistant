# Job Search Assistant

## Brief

A CLI tool (via Claude Code commands) that automates the Product Designer job search: scraping jobs from multiple boards, scoring and tracking them, with a local web dashboard for viewing results.

## Problem

Manually checking many job boards is slow and repetitive. No single tool surfaces and prioritizes Product Design roles well, or connects job discovery to application preparation.

## Vision

A personal dashboard that surfaces best-fit jobs automatically, tracks application status, and helps prepare tailored application materials — so the job search becomes a triage task, not a full-time job.

## Scope

### MPP (Minimum Personal Product)

**MPP Goal:** Working locally on UNRAID — scrape jobs from major boards, score them automatically, track status through the pipeline, and generate application materials via Claude + Figma.

#### Stories

- As a user, I can run scrapers to pull new job postings from multiple boards into a unified list
- As a user, I can see jobs scored and ranked by fit so I can triage quickly
- As a user, I can track each job through a status pipeline (backlog → applied → interviewing, etc.)
- As a user, I can score companies so their jobs surface higher or lower in rankings
- As a user, I can generate tailored resume/cover letter content via Claude + Figma MCP
- As a user, status changes auto-log TWC-compliant work search entries so I can fill out my weekly unemployment form without manual tracking
- As a user, company contact info (address, phone, website) is auto-enriched when I first engage with a job, pre-filling the work search log

## Assets

- Local web dashboard (`npx tsx scripts/serve.ts`) — read-only HTML view for backlog, active jobs, disqualified jobs, and work log

## Documentation

- [ROADMAP.md](ROADMAP.md) — Active roadmap
- [ROADMAP-DONE.md](ROADMAP-DONE.md) — Completed features
- [Search Issues](docs/search-issues.md) — Known issues and improvement opportunities in the job search pipeline
- [First Pass Improvements](docs/initiatives/first-pass-improvements/initiative.md) — Initiative (shipped): auto-expire, web view, external jobs
- [Smarter Auto-Classification](docs/initiatives/smarter-auto-classification/initiative.md) — Initiative (shipped): repost dedup, batch updates, separated search skills
- [Smarter Aggregator Handling](docs/initiatives/smarter-aggregator-handling/initiative.md) — Initiative (planned): reliable aggregator resolution

## Notes

- Runs locally as a CLI tool via Claude Code commands
- SQLite via libsql adapter (not standard Prisma SQLite) — `startsWith` filter not supported, must filter system terms in JavaScript
- System search terms prefixed with `__` (e.g. `__greenhouse__`) are never shown in the UI
