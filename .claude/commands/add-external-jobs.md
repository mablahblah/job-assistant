---
name: add-external-jobs
description: Accepts a list of links to job postings, and runs the post-scrape job search pipeline as if they were returned as job search results while also documenting each step to fully automated a job search and prioritization.
---

# Add External Jobs

Follow the steps explicitly, including each self-documentation, to add pasted external jobs, classify, and score job opportunities a user can apply for.

## Instructions

### Step 1: Investigate Pasted Jobs

1. Investigate the list of jobs added by the user. Somehow recreate the JSON that would be created from `scripts/scrape.ts` for the rest of the process.

2. `/self-document` Step 1 before proceeding to Step 2.

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
