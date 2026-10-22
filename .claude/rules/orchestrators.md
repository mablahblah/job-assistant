---
paths: ["lib/orchestrators/**/*.ts"]
---

# Orchestrators

An orchestrator calls handlers, the code that runs at one pipeline position, in pipeline order, and hands each one what it needs as arguments. Between handlers it runs named steps of its own that take no job list: reading a setting, looking up which jobs a handler should work on, opening or closing a tool such as a browser, checking that the run can start, or writing one fact through a service, the code that owns one table.

This rule covers the orchestrator files. The flow tests that sit beside them follow the naming rule.

- File: `lib/orchestrators/{subject}.ts`, named for what it runs — `job-search.ts`
- Function: `run{Subject}` — `runJobSearch`
- Options and result: `{Function}Options` and `{Function}Result`
