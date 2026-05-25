# Roadmap

Completed initiatives are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## _CURRENT_ Initiative: Pipeline Accuracy — [initiative](docs/initiatives/pipeline-accuracy/initiative.md)

_Goal: Stop misclassifying good jobs — fix location filtering and deduplication so the backlog reflects reality._

- [ |status:done] - **Staged Dedupe** — Three-stage deduplication with parser-based priority (merges Dedupe Priority). [spec](docs/initiatives/pipeline-accuracy/staged-dedupe.md)
- [ |status:done] - **Geocoding API Spike** _(research)_ — Evaluate geocoding providers against real pipeline location strings for accuracy, rate limits, cost, and edge case handling. [results](docs/initiatives/pipeline-accuracy/geocoding-api-spike-results.md)
- [ |status:done] - **Geo-based Location Classification** — Replace the string whitelist with geocoding + configurable radius check from the user's zip code. [spec](docs/initiatives/pipeline-accuracy/geo-location-classification.md) [plan](docs/initiatives/pipeline-accuracy/geo-location-classification-plan.md)

## Tech Debt & Bugs

_Items collected during initiative development. Triaged at ship time._

- [ |status:not started] - **Early break swallows unknown geo classes on multi-location jobs** — `classify-location.ts:118` breaks on first in-range fragment, skipping later fragments. Unknown classes on those skipped fragments are never surfaced to the user. No jobs are lost or misclassified, but the unknown class stays permanently unknown for multi-location jobs where one fragment is local. Single-location jobs still surface it correctly.
- [ |status:not started] - **Job-search skill understates new job count when jobs are held back** — Step 1 says "Note `save.saved`" but this excludes held-back jobs. User sees "15 saved" when 20 were actually new. Cosmetic — held-back jobs still get processed in step 2.
- [ |status:not started] - **No test for empty workMode in classify-location** — `classifyJobLocation` handles `workMode: ""` correctly (falls through to geo classification), but no test covers this path.
- [ |status:not started] - **Classify-location loop doesn't break early on unresolvable** — When a fragment is unresolvable and no fragment is in range, the loop continues geocoding remaining fragments unnecessarily. Result is correct but wastes API calls on multi-location jobs.
- [ |status:not started] - **Unknown class dedup loses per-location context** — `classifyJobLocations` deduplicates unknown classes by `className` only. If two jobs trigger the same unknown class from different locations, only the first location's context is kept. User still sees the class name for the allow/block decision.
- [ |status:not started] - **classify-held-back requires all unknown classes resolved** — If a held-back file has jobs from two unknown classes and the user only resolves one, the command refuses to save any jobs. Could partition and save the classifiable subset while holding back the rest.
- [ |status:not started] - **Held-back files accumulate silently** — No detection of unprocessed held-back files from prior pipeline runs. A second run before resolving the first orphans the first file's jobs. Data is recoverable from pipeline logs but not surfaced automatically.
