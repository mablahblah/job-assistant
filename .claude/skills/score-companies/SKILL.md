---
name: score-companies
description: Automatically score any unscored companies in the backlog.
---

# Score Companies

Score unscored companies in the backlog against the rubric.

## Instructions

### Step 1: Gather Companies to Score

1. Get the list of companies to score:

```bash
   npx tsx scripts/cli.ts unscored
```

### Step 2: Score Companies

For Each Company

IF company is an aggregator and job posting is not for said company

1. Add it to the Aggregator Table:

```bash
   npx tsx scripts/cli.ts add-aggregator "Company Name"
```

ELSE, score each metric _that has not been scored already_ on a 1 - 5 basis.

1. Score Employee Satisfaction (ES) using a web search for Glassdoor/Blind Ratings and qualitative reviews.

- **5** = high recommendation rate (85%+), low turnover signals, fair treatment reported
- **3** = middle of the road OR insufficient Glassdoor data
- **1** = toxic management, high turnover, layoffs as performance management

2. Score Customer Satisfaction (CS) using a web search for Trustpilot, BBB, and app store ratings.

- **5** = fair treatment, transparent practices, no dark patterns
- **3** = middle of the road OR no ratings found
- **1** = dark patterns, hidden fees, consumer complaints/lawsuits

3. Score Work/Life Balance (W/L) using a web search.

- **5** = respects employee time, no overtime expectation, mental health valued
- **3** = middle of the road OR no public info
- **1** = "we're a family" culture, long hours expected, hustle rewarded

4. Score Political Alignment (PA) - using a web search.

- **5** = progressive beyond legal requirements, strong DEI, no conservative donations
- **3** = middle of the road OR no public info
- **1** = only legally compliant, rolled back DEI, conservative-leaning donations

### Step 3: Write Score Explanation.

1. Write a 2-3 sentence note explaining rationale behind scores.

### Step 4: Save Scores

1. Save scores to DB

```bash
   npx tsx scripts/cli.ts score "Company Name" <es> <cs> <wl> <pa> "Note text"
```

### Step 5: Evaluate Job Alignment

1. Read `job-alignment.md` (in this skill's directory) and evaluate each job posting against the rubric.

### Step 6: Save Scores

1. Save all job alignment scores at once:

```bash
npx tsx scripts/cli.ts alignment <<'EOF'
[{"jobId":"<id>","score":<1-5>}, ...]
EOF
```

### Step 7: - Self Document

1. `/self-document` this step.
