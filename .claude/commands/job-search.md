---
name: job-search
description: Runs the full job search pipeline while also documenting each step to fully automated a job search and prioritization.
---

# Job Search

Follow the steps explicitly, including each self-documentation, to search, classify, score, and present job opportunities a user can apply for.

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

For each job in the `newJobs` array:

Run `npx tsx scripts/cli.ts aggregators` to get the known aggregator list. For each new job where the company name matches (case-insensitive) a known aggregator, flag it:

```bash
npx tsx scripts/cli.ts flag-aggregator <jobId>
```

Set these jobs aside — they'll be investigated in Step 4.

Use `/self-document` to document optimization for Step 2.

#### 2c. Repost check

For each new job, check if the DB already has a job with the same company and a very similar title (different URL). If so, mark the new one as a repost:

```bash
npx tsx scripts/cli.ts status <jobId> repost
```

Use `/self-document` to document optimization for Step 2c.

### Step 3: Score

Run `/score-companies` to score all unscored companies in the database. This command will:

- Identify unscored companies (excluding known aggregators)
- Web search and apply the scoring rubric (ES, CS, W/L, PA)
- Detect and flag any new aggregator/recruiter companies found
- Write scores to the database

Then for each new non-aggregator, non-repost job, evaluate Job Alignment (1-5) based on the scraped data using `.claude/rules/job-alignment.md`:

```bash
npx tsx scripts/cli.ts alignment <jobId> <score>
```

Use `/self-document` to document optimization for Step 3.

### Step 4: Investigate aggregators

For each aggregator-flagged job from Steps 2a and Step 3 (if any new aggregators were discovered):

1. Fetch the job URL and read the page content
2. Try to identify: the real hiring company, real salary, location, work mode, direct job URL
3. If you can identify the real company:
   - Unflag: `npx tsx scripts/cli.ts unflag-aggregator <jobId>`
   - Add the real company to the DB (if it doesn't exist): `npx tsx scripts/cli.ts add-company "Real Company Name"`
   - Run `/score-companies` again to score the newly discovered company
   - Score Job Alignment (1-5) and save: `npx tsx scripts/cli.ts alignment <jobId> <score>`
4. If the job is unresolvable, leave it flagged and note it in the output

Add any newly discovered aggregator names:

```bash
npx tsx scripts/cli.ts add-aggregator "New Aggregator Name"
```

Use `/self-document` to document optimization for Step 4.

### Step 5: Present results

#### Header

- "**X** new jobs added"
- "**Y** reposts found" (if any)
- "**Z** aggregator matches — **W** resolved, **V** unresolved" (if any)
- "**N** title mismatches flagged" (if any)

#### Jobs table

Show ALL new non-repost jobs, sorted by score descending:

| Score | Title | Company | Location | Mode | Salary | JA  |
| ----- | ----- | ------- | -------- | ---- | ------ | --- |

- Score = composite score (0-100)
- JA = Job Alignment (1-5 or "?")
- **Title must be a clickable markdown link** — render as `[Title text](url)` so users can click to open the posting
- Flag title mismatches with ⚠️ and show reason
- Flag unresolved aggregators with 🔍

#### Aggregator discoveries

If new aggregators were found, list them:

- "Added N new aggregators: [names]"

Use `/self-document` to document optimization for Step 5.
THEN
Use `/self-document` to document optimization for the process as a whole.
