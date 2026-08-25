# Legacy — Quarantined Pipeline

The job search pipeline as it stood before the [Unified Job Pipeline](../docs/features/unified-pipeline/feature_r&d.md) rebuild. It is here to be read and copied from, not extended.

## The rule

No bleed-through. The new pipeline imports nothing from this folder. Anything worth keeping is **copied** out, not referenced — so that shipping the rebuild means deleting this directory in one move.

## Running it

It does not run on this branch. Paths moved, and it is excluded from typecheck, lint, and tests. To run a real job search, switch to `main`, where the pipeline is untouched and working.

```bash
git checkout main        # run searches and applications here
git checkout feature/unified-pipeline   # come back to build
```

The database is untracked, so it survives branch switches. `dev.db` at the repo root is the live one.

## Contents

| Path | What it is |
|------|-----------|
| `lib/` | Collectors, parsers, geocoding, pipeline orchestration, scoring, web rendering |
| `scripts/` | `cli.ts` (CLI subcommands) and `serve.ts` (dashboard) |
| `prisma/` | Old schema and its migration history |
| `public/` | Dashboard CSS and JS |
| `rules/` | Path-scoped rules describing the old architecture, moved out of `.claude/rules/` so they no longer apply |

## Retirement

Delete this folder when the new pipeline is complete, after migrating active jobs, the work log, and company scores and enrichment onto the new database.
