---
name: post-scrape-pipeline
description: Shared post-scrape pipeline — classifies, scores, and presents new jobs. Called by job-search and add-external-jobs after their intake step.
user-invocable: false
---

# Post-Scrape Pipeline

Runs after new jobs have been collected and saved by the pipeline.

## Instructions

### Step 1: Auto-classify new jobs

1. Run `/auto-classify-jobs` to check for reposts.

### Step 2: Score

1. Run `/score-companies` to score and save each company and job post.

### Step 3: Serve Web UI

1. Run `/serve` to show results.

### Step 4: Self Document Entire Process

1. `/self-document` Entire process.
