---
name: eli5-comments
description: Add plain-English "explain it like I'm 5" comments to code as it's written or modified. Applied incrementally, not as a blanket pass.
user-invocable: false
---

When writing or modifying code, add ELI5 comments inline as you go:

- Explain **what** the code does in plain English, not just what it literally says
- Explain **why** it does it that way if it's not obvious
- Use simple language — assume the reader is smart but unfamiliar with this codebase
- Keep comments short (one line where possible)
- Don't comment every line — focus on anything that isn't immediately obvious to a non-author

Don't do a blanket pass over existing code. Only add comments to code you are actively writing or changing in the current task.

Example of a good ELI5 comment:
```ts
// Sort jobs by score descending so the best matches appear first
const sorted = jobs.sort((a, b) => b.score - a.score)
```
