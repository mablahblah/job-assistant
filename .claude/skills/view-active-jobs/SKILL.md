---
name: view-active-jobs
description: View Active Jobs
---

# View Active Jobs

Show jobs that are in the application pipeline (beyond backlog).

## Instructions

1. Run:
   ```bash
   npx tsx scripts/cli.ts active
   ```

2. Parse the JSON array. Each entry has: `#`, `id`, `title`, `company`, `status`, `location`, `workMode`, `salary`, `url`, `modified`.

3. Present as a compact table:

   **X active jobs**

   | # | Status | Title | Company | Location | Mode | Salary | Last Updated |
   |---|---|---|---|---|---|---|---|

   - `#` is the session number — usable with `/change-status`
   - **Title must be a clickable markdown link** — render as `[Title text](url)` so users can click to open the posting
   - Group by status if there are many jobs

4. If no active jobs, say "No jobs in the pipeline yet."
