# Job Search

Run the full job search pipeline: scrape → classify → score → investigate aggregators → present results.

## Step 0: Self-Documentation

Self-document issues with this flow in /docs/search-issues.md, if it doesn't exist, create it. The goal of this task is to fully automate a job search so it could potentially run as a cron job without user intervention. Right now it is highly innefficient. After each step, document any opportunities for improvement. These may be:

- If it is a repeatable action that can be done with a script
- Overly ambigious instructions that resulted in results that were not as expected, requiring a re-search
- Opportunities for simplificiation of the flow.
- Any other things we should be looking for.

## Step 1: Scrape

Run all enabled scrapers and save results to the database.

```bash
npx tsx scripts/scrape.ts
```

Read the JSON output. Note the `total.jobsNew` count and the `newJobs` array.

If `total.jobsNew` is 0, report "No new jobs found" and stop.

Document any issues: See "Self-Documentation"

## Step 2: Auto-classify new jobs

For each job in the `newJobs` array:

### 2a. Aggregator check

Run `npx tsx scripts/cli.ts aggregators` to get the known aggregator list. For each new job where the company name matches (case-insensitive) a known aggregator, flag it:

```bash
npx tsx scripts/cli.ts flag-aggregator <jobId>
```

Set these jobs aside — they'll be investigated in Step 4.

Document any issues: See "Self-Documentation"

### 2b. Title mismatch check

Compare each job title against the user's search terms (from the scrape output). If a title clearly doesn't match search intent (e.g., searched "product designer", got "graphic designer" or "project manager"), flag it with a reason:

```bash
npx tsx scripts/cli.ts flag-mismatch <jobId> "reason"
```

Still keep these jobs — they're flagged but saved.

Document any issues: See "Self-Documentation"

### 2c. Repost check

For each new job, check if the DB already has a job with the same company and a very similar title (different URL). If so, mark the new one as a repost:

```bash
npx tsx scripts/cli.ts status <jobId> repost
```

Document any issues: See "Self-Documentation"

## Step 3: Score

Run `/score-companies` to score all unscored companies in the database. This command will:

- Identify unscored companies (excluding known aggregators)
- Web search and apply the scoring rubric (ES, CS, W/L, PA)
- Detect and flag any new aggregator/recruiter companies found
- Write scores to the database

Then for each new non-aggregator, non-repost job, evaluate Job Alignment (1-5) based on the scraped data using `.claude/rules/job-alignment.md`:

```bash
npx tsx scripts/cli.ts alignment <jobId> <score>
```

Document any issues: See "Self-Documentation"

## Step 4: Investigate aggregators

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

Document any issues: See "Self-Documentation"

## Step 5: Present results

### Header

- "**X** new jobs added"
- "**Y** reposts found" (if any)
- "**Z** aggregator matches — **W** resolved, **V** unresolved" (if any)
- "**N** title mismatches flagged" (if any)

### Jobs table

Show ALL new non-repost jobs, sorted by score descending:

| Score | Title | Company | Location | Mode | Salary | JA  |
| ----- | ----- | ------- | -------- | ---- | ------ | --- |

- Score = composite score (0-100)
- JA = Job Alignment (1-5 or "?")
- **Title must be a clickable markdown link** — render as `[Title text](url)` so users can click to open the posting
- Flag title mismatches with ⚠️ and show reason
- Flag unresolved aggregators with 🔍

### Aggregator discoveries

If new aggregators were found, list them:

- "Added N new aggregators: [names]"

Document any issues: See "Self-Documentation"
