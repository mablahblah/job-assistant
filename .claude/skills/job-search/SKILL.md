---
name: job-search
description: Runs the job search pipeline to fully automate a job search and prioritization.
disable-model-invocation: true
---

# Job Search

Follow the steps explicitly to search for job opportunities a user can apply for.

## Instructions

### Step 1: Collect

1. Run the collection command:

```bash
npm run collect
```

2. Read the output. It arrives in three parts, in this order:
   - `Errors:` — a collector that could not complete. Either `none` or one indented line per error.
   - `Warnings:` — a collector that completed while degraded, or a job dropped because it could not travel. Either `none` or one indented line per warning.
   - The job list, as a single line of JSON.

   Each error and warning line reads `collector: message`. The message names the board or the search behind it, so it is reported as written and never rewritten.

   Progress lines go to stderr while the run is in flight. They are for watching, not for reporting.

3. Report every error and every warning before the jobs, and report all of them — several collectors can fail in one run, and the run continues past each. Then report how many jobs the list holds.

4. IF the job list is empty: report "No new jobs found" and STOP.
