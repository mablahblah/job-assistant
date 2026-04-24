---
name: self-document
description: Self documents command & skill flows after they are run to identify opportunities for optimization.
---

# Self Document

## Instructions

### Step 1: Reflect & Identify

1. Identify the ONE best opportunity for optimizing the previously accomplished step by asking yourself:

- Was any part of that possible with a repeatable script?
- No?, could that have been more token efficient with better instructions?
- No?, Were there any moments that could have been handled differently without requiring the user to confirm?
- No? Is there anything else that happened during this step that could have been fully automated.
- No? Any part of this script that could have been done differently to avoid a user having to confirm they want to proceed?

**Disqualified feedback:** Do not document issues with `/self-document` itself (e.g. skill invocation overhead, user turn pauses). Self-documentation is a temporary diagnostic tool — optimizing it is out of scope.

### Step 2: Prepare the Search Issues Doc

1. Read `docs/search-issues.md`

IF there is no heading in the doc for the step we just accomplished:

- Place a new one in chronological order. (e.g. `## Step 1: Scrape`)

### Step 3: Document

IF the ONE best opportunity we identified is already documented:

- Do not add anything. Relay to the user the opportunity and that it was already documented.
  ELSE:
- Document the opportunity below the current step.
- What can be optimized?
- How might it be optimized?
- What would the result be?
