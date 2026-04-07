# Job Search Assistant

## Brief

A local Next.js app that automates the Product Designer job search: scraping jobs from multiple boards, scoring and tracking them, and generating tailored resume/cover letter frames via Claude + Figma MCP.

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

## Assets

_None currently._

## Documentation

- [ROADMAP.md](ROADMAP.md) — Active roadmap
- [ROADMAP-DONE.md](ROADMAP-DONE.md) — Completed features

## Notes

- Deployed on personal UNRAID server via Docker
- SQLite via libsql adapter (not standard Prisma SQLite) — `startsWith` filter not supported, must filter system terms in JavaScript
- System search terms prefixed with `__` (e.g. `__greenhouse__`) are never shown in the UI
