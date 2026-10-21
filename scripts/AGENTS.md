# scripts — Agent Instructions

One entry point per npm command in [../package.json](../package.json). A script builds the services and tools a run shares, calls one orchestrator in `lib/orchestrators/`, and prints what came back. Which steps run, and in what order, belongs to the orchestrator, not the script. Root-level commands and boundaries are in [../AGENTS.md](../AGENTS.md).

## Run

Each script is run through its npm command, never directly: `npm run {command}`. What each command does is in [../CLAUDE.md](../CLAUDE.md#commands). Every script that reads or writes jobs checks the schema first and stops with a pointer to `npm run db:migrate` if the database has drifted. The `db-*` scripts are the exception, because they are what build and change the schema.

## Testing

```bash
npx vitest run scripts                       # every script test
npx vitest run scripts/job-search.test.ts    # one file
```

Script tests spawn the real script with `npx tsx` against a throwaway database, passing `PIPELINE_DATABASE_URL` in the environment so the real `pipeline.db` is never touched. Follow `scripts/job-search.test.ts` when adding one. Naming follows [../.claude/rules/naming.md](../.claude/rules/naming.md).

## Conventions

- A new command gets a script here, a line in `package.json`, and a test beside it.
- Logic belongs in `lib/`. A script only wires and prints; the printed summary is built by `lib/utils/run-summary.ts`.

## Boundaries

- ✅ **Always do:** keep the schema check first, before any browser or network call.
- ⚠️ **Ask first:** running any script here outside the test suite. Adding a new npm command.
- 🚫 **Never do:** give `db-create.ts` a default target or weaken its refusal of the real database. Read `.env` values into output.
