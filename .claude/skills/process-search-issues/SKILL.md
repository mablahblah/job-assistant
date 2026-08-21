---
name: process-search-issues
description: Convert items logged in the search issues .md file into backlog items
---

# Process Search Issues

`docs/search-issues.md` is a flat list of optimization opportunities logged by `/self-document`. Work through every entry in it.

## Instructions

For each entry in `docs/search-issues.md`:

### Step 1: Decide if it's still an issue

1. Determine whether it still matters:
   - Has it been done already?
   - Is it no longer relevant?
   - Would solving it no longer help make job searching or adding external jobs more efficient or autonomous?

### If no longer an issue:

2a. Remove the entry from `docs/search-issues.md`.
3a. If it is marked _Documented in Backlog_, also remove it from `docs/BACKLOG.md` (or `docs/CURRENT-FEATURE.md`).

### If still an issue:

2b. If the entry is already marked _Documented in Backlog_: skip to the next entry.

3b. Integrate it into the backlog:
   - If there is a relevant existing initiative, add it to that initiative
   - If there is no relevant existing initiative, but it belongs with an item in the Future/Ideas section, create a new initiative and place both items in it
   - Otherwise, add it to the Future/Ideas section

4b. Append ` _Documented in Backlog_` to the end of the entry's title, then replace the description with a link to the r&d doc of the backlog entry it landed in:

   - **{Issue title}** _Documented in Backlog_ — [{Backlog entry name}]({r&d path})
   - If the destination has no r&d doc: create one following the backlog rule, seeded with the issue's description, and link it from the backlog entry.

### Step 2: Leave the file usable

1. If every entry has been removed, restore the placeholder line `_No open issues._` so the next `/self-document` run has something to replace.
