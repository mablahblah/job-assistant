---
name: job-search
description: Runs the full job search pipeline while also documenting each step to fully automated a job search and prioritization.
---

# Job Search

Follow the steps explicitly, including each self-documentation, to search, classify, and score job opportunities a user can apply for.

## Instructions

### Step 1: Collect, Resolve URLs, and Parse

1. Run the production pipeline to collect, resolve, route, and parse jobs:

```bash
npx tsx -e "
import { collectAll } from './lib/collectors/collect-all';
import { runPipeline } from './lib/pipeline';
async function main() {
  const { jobs } = await collectAll();
  const result = await runPipeline(jobs, 'search');
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
"
```

2. Read the JSON output. Note the `save.saved` count and `save.savedJobIds`.

3. IF `save.saved` is 0: Report "No new jobs found" and STOP.

### Step 2: Self Document

1. `/self-document` this step.

### Step 3: Post-Scrape Pipeline

1. Run `/post-scrape-pipeline` to classify, score, and present the new jobs.
