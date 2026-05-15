---
name: add-external-jobs
description: Accepts a list of links to job postings, and runs the post-scrape job search pipeline as if they were returned as job search results while also documenting each step to fully automated a job search and prioritization.
---

# Add External Jobs

Follow the steps explicitly to add pasted external jobs, classify, and score them.

## Instructions

### Step 1: Run Pipeline on Pasted URLs

1. Take the list of URLs from the user and run each through the pipeline in external mode:

```bash
npx tsx -e "
import { runPipeline } from './lib/pipeline';
const jobs = [
  { url: '<URL_1>', source: 'external' },
  { url: '<URL_2>', source: 'external' },
];
async function main() {
  const result = await runPipeline(jobs, 'external');
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
"
```

Replace `<URL_1>`, `<URL_2>`, etc. with the actual pasted URLs.

2. `/self-document` Step 1 before proceeding to Step 2.

### Step 2: Post-Scrape Pipeline

1. Run `/post-scrape-pipeline` to classify, score, and present the new jobs.
