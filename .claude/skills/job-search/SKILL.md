---
name: job-search
description: Runs the job search pipeline to fully automate a job search and prioritization.
disable-model-invocation: true
---

# Job Search

Follow the steps explicitly to search for job opportunities a user can apply for.

## Instructions

### Step 1: Run the pipeline

1. Run the one command:

```bash
npm run job-search
```

   It runs the whole pipeline. What it does inside, and in what order, is the command's business — do not describe its internals to the user, and do not run any part of it separately.

   A headed browser window opens partway through and holds the screen while it works. Tell the user this before starting, so an opening window is expected rather than alarming.

2. Progress lines appear on stderr while the run is in flight. They are for watching, not for reporting.

### Step 2: Read the output

The output arrives on stdout in this order.

1. `Errors:` — either `none`, or one indented line per error. An error means a source could not complete.
2. `Warnings:` — either `none`, or one indented line per warning. A warning means a source completed while degraded, or a job was dropped because it could not travel.
3. `Run stopped at ...` — present only when the run stopped early. It names where it stopped and why, then lists what finished first.
4. `Trace failures: N` — present only when a diagnostic row failed to save. The run's work is unaffected.
5. The summary. Always present. It reads like this:

```
Collected: 100 jobs
  - adzuna collected 12 jobs
  - jsearch collected 0 jobs
  - greenhouse collected 31 jobs
  - lever collected 22 jobs
  - ashby collected 19 jobs
  - dribbble collected 9 jobs
  - uiuxjobsboard collected 7 jobs
  - 24 jobs already had a source link
Dedupe (post collection)
  - 13 jobs were duplicates from this collection
  - 7 jobs were duplicates of jobs already saved
Resolved: 55 jobs
  - 3 jobs could not be resolved
```

A line with nothing to report is left out. A collector that found nothing still gets its line, so a quiet source is visible rather than missing.

### Step 3: Report back

1. Report every error and every warning first, and report all of them. Several sources can fail in one run and the run continues past each. Each line reads `collector: message`. The message names the board or the search behind it, so report it as written and never reword it.

2. IF the run stopped early: say so plainly, name where it stopped and why, and say that the steps listed as finished did save their work. Then report the summary. Then STOP — do not treat a stopped run as a finished one.

3. Otherwise report the summary. Lead with how many jobs were collected and how many resolved.

4. IF nothing was collected and nothing was resolved: report "No new jobs found" and STOP.

## Notes

- The command exits non-zero when the run stopped early. Read the exit code rather than guessing from the text.
- Do not pass `--limit` unless the user asks for a short run. It exists for testing.
