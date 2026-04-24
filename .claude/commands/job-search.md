---
name: job-search
description: Runs the full job search pipeline while also documenting each step to fully automated a job search and prioritization.
---

# Job Search

Follow the steps explicitly, including each self-documentation, to search, classify, and score job opportunities a user can apply for.

## Instructions

### Step 1: Scrape

1. Run all enabled scrapers and save results to the database.

```bash
npx tsx scripts/scrape.ts
```

2. Read the JSON output. Note the `total.jobsNew` count and the `newJobs` array.

3. IF `total.jobsNew` is 0: Report "No new jobs found" and STOP.

4. `/self-document` Step 1 before proceeding to Step 2.

### Step 2: Auto-classify new jobs

1. Run `/auto-classify-jobs` to check for aggregators and reposts.

### Step 3: Score

1. Run `/score-companies` to score and save each company and job post.

### Step 4: Investigate aggregators

_TMP: For now skip this step._

1. Run `/investigate-aggregators` to identify and score real job postings behind aggregators.

### Step 5: Serve Web UI

1. Run `/serve` to show results.

### Step 6: Self Document Entire Process

1. `/self-document` Entire process.
