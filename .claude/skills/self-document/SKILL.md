---
name: self-document
description: Self documents command & skill flows after they are run to identify opportunities for optimization.
---

# Self Document

## Instructions

### Step 1: Reflect & Identify

1. Identify the ONE best opportunity for optimizing the previously accomplished step by asking yourself:
   - Was any part of that possible with a repeatable script?
   - No? Could that have been more token efficient with better instructions?
   - No? Were there any moments that could have been handled differently without requiring the user to confirm?
   - No? Is there anything else that happened during this step that could have been fully automated?
   - No? Any part of this script that could have been done differently to avoid a user having to confirm they want to proceed?

**Disqualified feedback:** Do not document issues with `/self-document` itself (e.g. skill invocation overhead, user turn pauses). Self-documentation is a temporary diagnostic tool — optimizing it is out of scope.

### Step 2: Ensure it isn't already logged

1. Check `docs/CURRENT-FEATURE.md` and `docs/BACKLOG.md` and `docs/search-issues.md`
   - If this issue will be resolved with future work already documented: stop.

### Step 3: Prepare the Search Issues Doc

1. Read `docs/search-issues.md`
   - If there is no heading in the doc for the step we just accomplished: place a new one in chronological order (e.g. `## Step 1: Scrape`)

### Step 4: Document

1. Check if the ONE best opportunity we identified is already documented
   - If already documented: do not add anything. Relay to the user the opportunity and that it was already documented.
   - If not documented: add it below the current step heading with:
     - What can be optimized?
     - How might it be optimized?
     - What would the result be?
