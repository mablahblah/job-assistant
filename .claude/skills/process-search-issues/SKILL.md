---
name: process-search-issues
description: Convert items logged in the search issues .md file into backlog items
---

# Process Search Issues

## Instructions

For each logged issue in `docs/search-issues.md`:

### Step 1: Clean Irrelevant Issues

1. Determine if it's still an issue:
   - Has it been done already?
   - Is it no longer relevant?
   - Would solving this issue no longer help make job searching or adding external jobs more efficient or autonomous?

### If no longer an issue and it says it has been documented in the backlog:

2a. Remove issue from `docs/search-issues.md` and `docs/BACKLOG.md` (or `docs/CURRENT-FEATURE.md`)
3a. If there are no more issues under the heading, remove heading as well.

### If still an issue:

2b. Check if the issue states it has been documented in backlog
   - If already documented: skip to next issue

3b. Integrate it into backlog:
   - If there is a relevant existing initiative, add it to that initiative
   - If there is no relevant existing initiative, but it belongs with an item in the Future/Ideas section, create a new initiative and place both items in it
   - Otherwise, add it to Future/Ideas section

4b. Between issue title and issue description add _Documented in Backlog_
