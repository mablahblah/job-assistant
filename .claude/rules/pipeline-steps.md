---
paths: ["lib/**/*.ts", "scripts/**/*.ts"]
---

# Pipeline Steps

A step takes a job list, acts on every entry, and returns a job list. Collection is the one exception: it has no list to take and builds the first one.

A step is called once with the whole list, never from inside another step's per-job loop.

Per-job work lives in a function the step calls, never in the step's own signature. `normalizeJob` acts on one job and is not a step; `normalizeJobs` takes the list and is.

A step writes its own trace rows through the trace service in `lib/trace-writer.ts`. Its caller hands it the run id and the step name, because the same step runs at more than one point in the pipeline. A step handed neither writes no trace and still does its work.

A step returns no trace events for its caller to write.

A step name is one of the values listed in the `Trace` model's comment in `prisma/schema.prisma`.

A step reads no database of its own beyond the trace service. Everything else it needs arrives as an argument.
