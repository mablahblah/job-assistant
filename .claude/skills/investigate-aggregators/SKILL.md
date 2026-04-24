---
name: investigate-aggregators
description: Investigate Aggregators to determine real job posting and company info, for proper linking and scoring.
---

For each aggregator-flagged job from Steps 2a and Step 3 (if any new aggregators were discovered):

1. Fetch the job URL and read the page content
2. Try to identify: the real hiring company, real salary, location, work mode, direct job URL
3. If you can identify the real company:
   - Unflag: `npx tsx scripts/cli.ts unflag-aggregator <jobId>`
   - Add the real company to the DB (if it doesn't exist): `npx tsx scripts/cli.ts add-company "Real Company Name"`
   - Run `/score-companies` again to score the newly discovered company
   - Score Job Alignment (1-5) — collect all resolved scores and save them in one batch call at the end of Step 4:

```bash
npx tsx scripts/cli.ts alignment <<'EOF'
[{"jobId":"<id>","score":<1-5>}, ...]
EOF
```

4. If the job is unresolvable, leave it flagged and note it in the output

Add any newly discovered aggregator names:

```bash
npx tsx scripts/cli.ts add-aggregator "New Aggregator Name"
```

Use `/self-document` to document optimization for Step 4.
