---
paths: ["lib/handlers/**/*.ts"]
---

# Handler Contract

## Shape

A handler takes a job list, acts on every entry, and returns that list along with the warnings it raised. Collection is the one exception: it takes no list, because it builds the first one.

A handler runs once per position in the pipeline, never from inside another handler's per-job loop.

Per-job work lives in a function the handler calls, never in the handler's own signature. `normalizeJob` acts on one job and is not a handler; `normalizeJobs` takes the list and is.

A handler reads no database of its own beyond the trace service. Everything else it needs arrives as an argument.

A handler is named for what it does to a job list. One handler serves every position it runs at.

## Trace and warnings

A trace row is analytics. It records that something happened, lands in the database as the handler runs, and changes nothing. Nobody is told.

A warning is validation. Something is wrong that the user needs to know, so the handler returns it, its caller passes it up, and the agent presents it.

One event produces both where it is both. A salary that could not be read writes a trace row and returns a warning.

A handler writes its own trace rows through the trace service in `lib/services/trace-service.ts`. Its caller hands it the run id and the step name, because the same handler runs at more than one point in the pipeline. A handler handed neither writes no trace and still does its work.

A handler returns no trace events for its caller to write.

A step name is one of the values listed in the `Trace` model's comment in `prisma/schema.prisma`.
