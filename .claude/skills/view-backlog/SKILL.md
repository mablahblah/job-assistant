---
name: view-backlog
description: View Backlog
---

# View Backlog

Show backlog jobs from the last 7 days, ranked by weighted score.

## Instructions

1. Run:
   ```bash
   npx tsx scripts/cli.ts backlog
   ```

   This auto-expires jobs older than 8 days before returning results.

2. Parse the JSON array. Each entry has: `#`, `id`, `score`, `title`, `company`, `location`, `workMode`, `salary`, `url`, `ja`, `posted`.

3. Present as a compact table:

   **X backlog jobs** (ranked by score)

   | # | Score | Title | Company | Location | Mode | Salary | JA | Posted |
   |---|---|---|---|---|---|---|---|---|

   - `#` is the session number — usable with `/change-status` (e.g., "change job 3 to app. sent")
   - Score = composite 0-100
   - JA = Job Alignment (1-5 or "?")
   - Mode = remote/hybrid/in-person
   - **Title must be a clickable markdown link** — render as `[Title text](url)` so users can click to open the posting

4. Session numbers are valid for this conversation only. Remind the user they can use `/change-status` to act on jobs.
