# Score Companies

Score unscored companies against the rubric below. Called by `/job-search` during the pipeline, but also invocable standalone.

## Inputs

- If called standalone (no arguments): score all companies with null scores
- If called with company names: score only those companies

## Instructions

1. Get the list of companies to score:
   ```bash
   npx tsx scripts/cli.ts unscored
   ```
   If called with specific names, filter to those.

2. For each company, web search for the information sources listed in the rubric below.

3. Score each dimension 1–5. If a company has insufficient public info for a dimension, score it 3 and note that in the rationale.

4. Write a 2–3 sentence note explaining the scores. Call out if any ratings are set due to missing info.

5. Save to DB:
   ```bash
   npx tsx scripts/cli.ts score "Company Name" <es> <cs> <wl> <pa> "Note text"
   ```

6. Skip companies that already have all 4 scores populated, unless explicitly asked to re-score.

7. If a company appears to be a recruiter or job aggregator (not the actual hiring company), do NOT score it. Instead, add it to the aggregators table:
   ```bash
   npx tsx scripts/cli.ts add-aggregator "Company Name"
   ```

## Rubric

### Employee Satisfaction (ES) — 1 to 5
Research Glassdoor/Blind ratings and qualitative reviews.
- **5** = high recommendation rate (85%+), low turnover signals, fair treatment reported
- **3** = middle of the road OR insufficient Glassdoor data
- **1** = toxic management, high turnover, layoffs as performance management

### Customer Satisfaction (CS) — 1 to 5
Use Trustpilot, BBB, app store ratings.
- **5** = fair treatment, transparent practices, no dark patterns
- **3** = middle of the road OR no ratings found
- **1** = dark patterns, hidden fees, consumer complaints/lawsuits

### Work/Life Balance (W/L) — 1 to 5
- **5** = respects employee time, no overtime expectation, mental health valued
- **3** = middle of the road OR no public info
- **1** = "we're a family" culture, long hours expected, hustle rewarded

### Political Alignment (PA) — 1 to 5
- **5** = progressive beyond legal requirements, strong DEI, no conservative donations
- **3** = middle of the road OR no public info
- **1** = only legally compliant, rolled back DEI, conservative-leaning donations

## Output

Present a summary table:

| Company | ES | CS | W/L | PA | Note |
|---|---|---|---|---|---|

Report how many companies were scored and any that were flagged as aggregators.
