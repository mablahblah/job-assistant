# lib — Agent Instructions

All app code. Every file sits in a folder named for the kind of thing it is, and `lib/` holds no file of its own. Root-level commands and boundaries are in [../AGENTS.md](../AGENTS.md).

## Where code goes

The folder map is in [../.claude/rules/naming.md](../.claude/rules/naming.md). What each kind of part owns and never does is in [../.claude/rules/part-ownership.md](../.claude/rules/part-ownership.md). Each folder has its own rule, which applies automatically by path:

| Folder | Rule |
| --- | --- |
| `collectors/`, `parsers/` | [sources.md](../.claude/rules/sources.md), plus [source-registry.md](../.claude/rules/source-registry.md) for `registry.ts` |
| `handlers/` | [handler-contract.md](../.claude/rules/handler-contract.md) |
| `orchestrators/` | [orchestrators.md](../.claude/rules/orchestrators.md) |
| `resolvers/` | [resolvers.md](../.claude/rules/resolvers.md) |
| `services/` | [services.md](../.claude/rules/services.md) |
| `tools/` | [tools.md](../.claude/rules/tools.md) |
| `types/` | [types.md](../.claude/rules/types.md) |
| `utils/` | [utils.md](../.claude/rules/utils.md), plus [run-summary.md](../.claude/rules/run-summary.md) for `run-summary*.ts` |
| `views/` | [views.md](../.claude/rules/views.md) |

Entry point for a job search: `orchestrators/job-search.ts` (`runJobSearch`). Only `db/` builds a database connection.

## Testing

```bash
npx vitest run lib/handlers               # one folder
npx vitest run lib/utils/title.test.ts    # one file
```

- A unit test sits beside its file. A flow test (`{scenario}.flow.test.ts`) sits beside the orchestrator it drives.
- Shared stand-ins are `services/*.fake.ts` and `tools/*.fake.ts`. Reuse one where it exists.
- No test reaches a live job site, a browser or a paid service.

## Boundaries

- ✅ **Always do:** hand services and tools in as arguments. Keep a plain function in `utils/` free of any import from `handlers/` or `orchestrators/`, type-only imports included.
- ⚠️ **Ask first:** adding a new folder or a new kind of part. Changing a contract file (`collectors/collector.ts`, `parsers/parser.ts`).
- 🚫 **Never do:** branch on which collector produced a job. Write a second implementation of dedupe, save, resolution, normalization, location matching, backlog cleanup or tracing. Put a site's name or domain in code outside `collectors/` and `parsers/`.
