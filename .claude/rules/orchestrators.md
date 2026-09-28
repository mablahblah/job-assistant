---
paths: ["lib/orchestrators/**/*.ts"]
---

# Orchestrators

An orchestrator calls handlers in pipeline order and hands each one what it needs as arguments.

- File: `lib/orchestrators/{subject}.ts`, named for what it runs — `job-search.ts`
- Function: `run{Subject}` — `runJobSearch`
- Options and result: `{Function}Options` and `{Function}Result`
