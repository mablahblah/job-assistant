---
paths: ["lib/handlers/**/*.ts"]
---

# Handler Contract

## Shape

A handler takes a list, acts on every entry, and returns that list, with the warnings it raised if it is a step that can raise any. Most handlers are handed jobs. Backlog cleanup's company sweep is handed companies, and `saveCompanies` is handed companies too. Collection is the one exception to taking a list: it takes none, because it builds the first one.

The list comes back under the name of what is in it — `jobs` for a job list, `companies` for a company list — never both on one result.

A handler runs once per position in the pipeline, never from inside another handler's per-job loop.

Per-entry work lives in a function the handler calls, never in the handler's own signature. `normalizeJob` acts on one job and is not a handler; `normalizeJobs` takes the list and is.

A handler reads no database of its own beyond the trace service. Everything else it needs arrives as an argument.

One handler serves every position it runs at.

## Naming

- File: `lib/handlers/{subject}.ts`, named for what the handler does to its list
- Function: a verb and a plural noun — `normalizeJobs`, `saveJobs`
- Options and result: `{Function}Options` and `{Function}Result`
- Parameters: the list, then an options object. Collection takes options only.
- A service handed to a handler arrives under a plain noun naming what it is for: `companies`, `settings`, `trace`. Where that noun is already the list's name, the field is `{subject}Service`.

## Trace and warnings

A trace row is analytics. It records that something happened, lands in the database as the handler runs, and changes nothing. Nobody is told.

A warning is validation. Something is wrong that the user needs to know, so the handler returns it, its caller passes it up, and the agent presents it.

One event produces both where it is both. A salary that could not be read writes a trace row and returns a warning.

A handler writes its own trace rows through the trace service in `lib/services/trace-service.ts`. Its caller hands it the run id and the step name, because the same handler runs at more than one point in the pipeline. A handler handed neither writes no trace and still does its work.

A handler returns no trace events for its caller to write.

A step name is one of the values listed in the `Trace` model's comment in `prisma/schema.prisma`.
