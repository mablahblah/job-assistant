---
name: job-search
description: Runs the full job search pipeline to fully automate a job search and prioritization.
disable-model-invocation: true
---

# Job Search

Follow the steps explicitly to search, classify, and score job opportunities a user can apply for.

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

2. Read the JSON output. Note:
   - `save.saved` — number of jobs saved immediately
   - `save.savedJobIds` — IDs of saved jobs
   - `heldBack.count` — number of jobs held back pending geocoding class review
   - `heldBack.file` — path to the held-back jobs file (if any)

3. IF `save.saved` is 0 AND (`heldBack.count` is 0 or not present): Report "No new jobs found" and STOP.

### Step 2: Post-Scrape Pipeline

1. Run `/post-scrape-pipeline` to classify, score, and present the new jobs.
