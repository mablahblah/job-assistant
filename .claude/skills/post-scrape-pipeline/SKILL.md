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

### Step 2: Handle unknown geocoding classes

If the pipeline output from Step 1 included `heldBack.count > 0`:

1. Note the `heldBack.file` path and the `unknownGeoClasses` array from the pipeline output — these are needed for the steps below.
2. Present each unknown class to the user with context:
   - Class name (e.g., "leisure")
   - The location string that triggered it (e.g., "Central Park, NYC")
   - What it resolved to (e.g., "Central Park, Manhattan, New York")
3. For each, ask the user: "Should locations with class `<className>` be **allowed** (treated as real locations) or **blocked** (treated as bogus results)?"
4. For allowed classes, run: `npx tsx scripts/cli.ts geocode-class allow <className>`
5. For blocked classes, run: `npx tsx scripts/cli.ts geocode-class block <className>`
6. After ALL unknown classes are resolved, classify and save the held-back jobs using the file path from step 1:

```bash
npx tsx scripts/cli.ts classify-held-back <path from heldBack.file>
```

7. Report the save result (how many saved, how many classified as backlog vs too far).

If `heldBack.count` is 0 (or no `heldBack` field), skip this step.

### Step 3: Score

1. Run `/score-companies` to score and save each company and job post.

### Step 4: Summarize Results

1. Reflect on job search, and provide:
- Collection: How many jobs were collected in the initial collection, broken out by:
   - How many collected by each collector, broken out by
      - How many were duplicates from other collectors, broken out by:
         - Where the collectors overlapped, and which of the overlaps was saved.
      - How many were duplicates that already exist in db
      - How many moved to next stage of pipeline
- URL Resolution:
   - How many jobs went through URL resolution, broken out by:
      - How many were successfully resolved
      - How many were unsuccessfully resolve
   - How many jobs skipped URL resolutions because they were greenlit URLs?
   - How many resolved URLS matched jobs in our db?
- Parsing
   - How many jobs were parsed? Broken out by:
      - How many jobs per parser.
   - How many jobs did not match existing parser, and were abandoned.
- Classification
   - Total Jobs that were successfully parsed, and moved to classification, broken out by:
      - Jobs that were duplicates of other classified jobs, broken out by:
         - Where parsers overlapped, and which of the overlaps was saved (by collector).
      - Jobs that were duplicates of existing jobs (same job, same age)
      - Jobs that were reposts
      - Jobs that were expired
      - Jobs that were NOT expired, broken out by:
         - Jobs that were too far (each job listed w/ location, distance in miles, and workmode type)
         - Jobs that were not too far (each job listed w/ location, distance, and workmode type)

2. If any information was restricting you from the previous reflection, list this here so we can add proper logging.         

### Step 5: Serve Web UI

1. Run `/serve` to show results.

### Step 6: Self Document Entire Process

1. `/self-document` Entire process.
