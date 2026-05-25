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

For each company:

1. Evaluate the company

### If company is an aggregator and the job posting is not for said company:

2a. Add it to the Aggregator Table:

```bash
npx tsx scripts/cli.ts add-aggregator "Company Name"
```

### Otherwise:

2b. Score each metric _that has not been scored already_ on a 1 - 5 basis.

- Score Employee Satisfaction (ES) using a web search for Glassdoor/Blind Ratings and qualitative reviews.
  - **5** = high recommendation rate (85%+), low turnover signals, fair treatment reported
  - **3** = middle of the road OR insufficient Glassdoor data
  - **1** = toxic management, high turnover, layoffs as performance management

- Score Customer Satisfaction (CS) using a web search for Trustpilot, BBB, and app store ratings.
  - **5** = fair treatment, transparent practices, no dark patterns
  - **3** = middle of the road OR no ratings found
  - **1** = dark patterns, hidden fees, consumer complaints/lawsuits

- Score Work/Life Balance (W/L) using a web search.
  - **5** = respects employee time, no overtime expectation, mental health valued
  - **3** = middle of the road OR no public info
  - **1** = "we're a family" culture, long hours expected, hustle rewarded

- Score Political Alignment (PA) using a web search.
  - **5** = progressive beyond legal requirements, strong DEI, no conservative donations
  - **3** = middle of the road OR no public info
  - **1** = only legally compliant, rolled back DEI, conservative-leaning donations

3b. Write a 2-3 sentence note explaining rationale behind scores.

4b. Save scores to DB:

```bash
npx tsx scripts/cli.ts score "Company Name" <es> <cs> <wl> <pa> "Note text"
```

5b. Read `job-alignment.md` (in this skill's directory) and evaluate each job posting against the rubric.

6b. Save all job alignment scores at once:

```bash
npx tsx scripts/cli.ts alignment <<'EOF'
[{"jobId":"<id>","score":<1-5>}, ...]
EOF
```

7b. `/self-document` this step.
