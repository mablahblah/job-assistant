# Roadmap

Completed initiatives are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## _NEXT_: Pipeline Accuracy

_Goal: Stop misclassifying good jobs — fix location filtering, deduplication, and date handling so the backlog reflects reality._

- [ ] **Expand AUSTIN_AREA whitelist** — Add missing Austin-metro neighborhoods (bee cave, tarrytown, dessau, bluff springs) that cause jobs to be misclassified as "too far"
- [ ] **Geo-based Location Classification** — Replace the string whitelist with geocoding + radius check. Solves nearby-city misses and Adzuna's unreliable distance filter returning jobs in Fort Worth, NYC, etc.
- [ ] **Dedupe Priority for Greenlit URLs** — Priority system at any dedupe stage to decide which match is saved and which is abandoned
- [ ] **Staged Dedupe** — Dedupe at two stages: post-collection (collected URLs) and post-resolution (resolved URLs against DB, also where repost checking happens)
- [ ] **Set Modified Date on auto-expired and 'too far' Jobs** — Disqualified jobs never appear at top of their list because modified date isn't set during pipeline classification
