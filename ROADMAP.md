# Roadmap

Completed initiatives are in [ROADMAP-DONE.md](ROADMAP-DONE.md).

## _CURRENT_: [Smarter Auto-Classification](docs/initiatives/smarter-auto-classification/initiative.md)

_Goal: The pipelines run end-to-end with fewer CLI calls, fewer tokens, and less manual intervention._

- [x] **Repost Deduplication** — Don't treat replaced jobs as truly new; skip already-classified dupes in downstream steps
- [x] **Batch Update Command** — Single CLI call for title mismatches and alignment scores instead of N sequential calls
- [~] **Batch Scores Command** — ~~Compute composite scores for arbitrary job IDs in one call, regardless of status~~ _Cancelled: solves a problem that doesn't exist — backlog command already scores the jobs that matter_
- [x] USER ONLY - Break apart job search and add job commands into separate re-usable skills
