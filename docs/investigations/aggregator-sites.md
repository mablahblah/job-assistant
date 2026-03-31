# Investigation: Aggregator Site Company Mismatch

## Problem

Many scraped jobs come from aggregator sites (e.g. Remotica, ZipRecruiter, Indeed) that re-host
postings from real companies. The `companyName` field on these jobs ends up being the aggregator
name instead of the actual hiring company.

**Example:** A job listed on Remotica (`https://remotica.totalh.net/job/...`) comes through with
company = "Remotica" instead of the real hiring company behind the listing.

**Likely sources:** Adzuna, jSearch (both are aggregators themselves that index other aggregators).

## Proposed Approach

Detection + resolution in `lib/scraper-save.ts`, inserted after the blocked-URL check (line 38),
before the company upsert. New module: `lib/scrapers/aggregators.ts`.

**Pipeline step:** blocked → **aggregator** → expired → too far → backlog

**Resolution logic:**
1. Maintain a set of known aggregator domains
2. If job URL matches, do a HEAD request to follow redirects to the final URL
3. Try to extract real company from final URL:
   - Greenhouse slug pattern (`boards.greenhouse.io/<slug>/...`)
   - Lever slug pattern (`jobs.lever.co/<slug>/...`)
   - Fallback: extract from domain (e.g. `stripe.com` → "Stripe")
4. If final URL is still an aggregator, times out, or can't be parsed → skip the job (`continue`)

**Remotica verdict:** Messy redirect chain, not worth resolving — add to skip list.

## Status

Paused — need to observe more real-world examples before committing to an implementation.
Collect: which scrapers surface aggregator jobs most, and what the redirect chains look like.
