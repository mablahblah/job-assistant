---
paths: ["lib/collectors/**", "lib/parsers/**", "lib/pipeline.ts", "lib/pipeline-save.ts", "lib/dedupe.ts", "lib/dedupe.test.ts"]
---

# Pipeline — Collectors, Parsers, & Orchestration

## Data Format Invariants

`workMode` values: `"remote"`, `"hybrid"`, `"in-person"`, or `""` (unknown). `"onsite"` is not valid.

`salaryRange` uses `"?"` when unknown — not empty string. Known salaries format as `$XXX-$XXXk`.

`postedAt` is an ISO date string. Prisma DateTime fields reject date-only strings — coerce to full ISO-8601.

## Collectors

Collectors return `CollectedJob[]` from `lib/collectors/types.ts`. Only `url` and `source` are required — all other fields are optional metadata.

New collectors register in `lib/collectors/collector-config.ts`. Keyword-based collectors use `SEARCH_TERMS`; direct collectors (Greenhouse, Lever) use slug lists.

## Parsers

Parsers implement `ParserFn` from `lib/parsers/types.ts`: `(url, browser, collectorData?) => Promise<ParserResult>`.

New parsers register via `registerParser(domain, fn)` in `lib/pipeline.ts`.

Three parser patterns:
- **API** (Greenhouse, Lever, Ashby) — structured data from ATS APIs
- **HTML fetch** (Dribbble) — static HTML with inline script extraction
- **Pass-through** (Adzuna) — returns collector data as-is for aggregators with no independent source page

Pass-through parsers require a **source gate** in `pipeline.ts` preventing non-matching collector data from being silently saved.

## Domain Matching

Domain-to-parser routing uses `matchDomain()` from `lib/parsers/registry.ts`. Custom domain checks are not used — `matchDomain` handles exact matches, Greenhouse wildcards (`*.greenhouse.*`), and subdomain fallback.

## Deduplication

Three stages in `lib/dedupe.ts`, ordered cheapest-first: collect → **Dedupe 1** → resolve → **Dedupe 2** → route → parse → **Dedupe 3** → save.

**Dedupe 1** (post-collection): `dedupeByUrl()` against `job.originalUrl`. Drops re-collected jobs before resolution.

**Dedupe 2** (post-resolution): `dedupeByUrl()` against `job.url`. Catches convergent redirects.

**Dedupe 3** (post-parsing): `dedupeByContent()` matches by title+company. Priority cascade: better parser wins → newer date wins (flags repost) → existing record wins. Empty fields on the winner are filled from the loser (`null`, `""`, and `"?"` count as empty).

`PARSER_PRIORITY` in `dedupe.ts` is a manually-maintained 1-N ranking by result quality (lower = better). New parsers need a priority rank.

`REPLACEABLE_STATUSES` in `dedupe.ts` controls which DB statuses Dedupe 3 may overwrite. Active statuses (applied, interviewing, etc.) are never touched. Update this set when adding a new status.

## Confidence

When both parser and collector provide data for the same field, confidence comparison in `lib/parsers/confidence.ts` picks the winner. Parser output takes priority on disagreement.
