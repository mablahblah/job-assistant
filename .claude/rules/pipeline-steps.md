---
paths: ["lib/steps/**/*.ts"]
---

# Pipeline Steps

## Shape

A step takes a job list, acts on every entry, and returns that list along with the warnings it raised. Collection is the one exception: it has no list to take and builds the first one.

A step is called once with the whole list, never from inside another step's per-job loop.

Per-job work lives in a function the step calls, never in the step's own signature. `normalizeJob` acts on one job and is not a step; `normalizeJobs` takes the list and is.

A step reads no database of its own beyond the trace service. Everything else it needs arrives as an argument.

## Trace and warnings

A trace row is analytics. It records that something happened, lands in the database as the step runs, and changes nothing. Nobody is told.

A warning is validation. Something is wrong that the user needs to know, so the step returns it, its caller passes it up, and the agent presents it.

One event produces both where it is both. A salary that could not be read writes a trace row and returns a warning.

A step writes its own trace rows through the trace service in `lib/trace-service.ts`. Its caller hands it the run id and the step name, because the same step runs at more than one point in the pipeline. A step handed neither writes no trace and still does its work.

A step returns no trace events for its caller to write.

A step name is one of the values listed in the `Trace` model's comment in `prisma/schema.prisma`.
