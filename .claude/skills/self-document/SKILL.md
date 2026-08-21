---
name: self-document
description: Self documents command & skill flows after they are run to identify opportunities for optimization.
---

# Self Document

Runs once at the end of a full pipeline run, reflecting on the whole process rather than any single step.

## Instructions

### Step 1: Reflect & Identify

1. Identify the ONE best opportunity for optimizing the process that was just run, by asking yourself:
   - Was any part of it possible with a repeatable script?
   - No? Could it have been more token efficient with better instructions?
   - No? Were there any moments that could have been handled differently without requiring the user to confirm?
   - No? Is there anything else that happened during the run that could have been fully automated?
   - No? Any part of it that could have been done differently to avoid a user having to confirm they want to proceed?

**Disqualified feedback:** Do not document issues with `/self-document` itself (e.g. skill invocation overhead, user turn pauses). Self-documentation is a temporary diagnostic tool — optimizing it is out of scope.

### Step 2: Ensure it isn't already logged

1. Check `docs/CURRENT-FEATURE.md`, `docs/BACKLOG.md`, and `docs/search-issues.md`
   - If the opportunity is already logged, or will be resolved by work already documented: do not add anything. Tell the user what you found and where it's already covered, then stop.

### Step 3: Document

1. Add ONE entry to the top of the list in `docs/search-issues.md`, in this shape:

```markdown
- **Short title naming the problem** — What can be optimized, how it might be optimized, and what the result would be. Name the specific files, commands, or skills involved.
```

2. If the file reads `_No open issues._`, replace that line with the entry.
