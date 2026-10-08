---
paths: ["lib/orchestrators/**/*.ts"]
---

# Orchestrators

An orchestrator calls handlers in pipeline order and hands each one what it needs as arguments.

This rule covers the orchestrator files. The flow tests that sit beside them follow the naming rule.

- File: `lib/orchestrators/{subject}.ts`, named for what it runs — `job-search.ts`
- Function: `run{Subject}` — `runJobSearch`
- Options and result: `{Function}Options` and `{Function}Result`
