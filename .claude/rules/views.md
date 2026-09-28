---
paths: ["lib/views/**/*.ts"]
---

# Views

A view takes values and returns HTML, the text a browser reads to draw a page. It reaches no database and calls nothing outside itself.

- File: `lib/views/{subject}.ts`, named for what it builds — `job-table.ts`
- Function: `{subject}View` — `jobTableView`
- A util answers one small question about a value. A view owns a whole screen, or a whole part of one, and answers with HTML.
