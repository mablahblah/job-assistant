---
name: auto-classify-jobs
description: Automatically classify new jobs that were collected in the previous scrape.
---

# Auto Classify Jobs

## Instructions

### Step 1: Check for Aggregators

1. For each job in the `newJobs` array run `npx tsx scripts/cli.ts aggregators` to get the known aggregator list.

2. IF a new job matches a known aggregator
   - flag it:

Flag all aggregator matches at once:

```bash
npx tsx scripts/cli.ts flag-aggregator <<'EOF'
["<jobId1>", "<jobId2>", ...]
EOF
```

### Step 2 - Check for Reposts

1. For each job in the `newJobs` array run the following to check if the job has the same company name with a similar title to flag jobs as reposts:

Mark all reposts at once:

```bash
npx tsx scripts/cli.ts status <<'EOF'
[{"jobId":"<id>","status":"repost"}, ...]
EOF
```

### Step 3 - Self Document

1. `/self-document` this step.
