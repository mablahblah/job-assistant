---
name: auto-classify-jobs
description: Automatically classify new jobs that were collected in the previous scrape.
---

# Auto Classify Jobs

## Instructions

### Step 1: Check for Reposts

1. For each job in the new jobs, check if the job has the same company name with a similar title to flag jobs as reposts:

Mark all reposts at once:

```bash
npx tsx scripts/cli.ts status <<'EOF'
[{"jobId":"<id>","status":"repost"}, ...]
EOF
```

### Step 2: Self Document

1. `/self-document` this step.
