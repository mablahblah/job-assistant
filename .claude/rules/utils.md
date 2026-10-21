---
paths: ["lib/utils/**/*.ts"]
---

# Utils

A util takes values, returns values, and reaches no database.

- File: `lib/utils/{subject}.ts`, named for its subject
- Its name is a noun for what it returns, or the yes-or-no question it answers. Common shapes: `{a}From{b}` or `{a}To{b}` when converting — `messageFromThrown`; `is{X}` or `matches{X}` when answering yes or no — `isActiveStatus`.
- A util read by one folder only still lives here.
- A util never imports from `lib/handlers/` or `lib/orchestrators/`, including imports that bring in only types.
