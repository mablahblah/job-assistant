---
paths: ["lib/utils/run-summary*.ts"]
---

# Run Summary

## Every step prints

A step prints whether or not it had work. A step handed nothing shows its heading and its zero, because a missing block reads as a step that never ran.

```
Classification (0 jobs)
```

## A heading carries what entered

The number beside a step's name is the jobs handed to it, and every line beneath is measured against it.

Collection is the one exception: it takes no job list, so its heading carries the sources it ran and its lines account for what they produced.

## The lines account for every job

Each job that entered leaves by exactly one line, and the lines sum to the heading. A job counted twice, or counted by no line, is a defect.

```
Resolution (157 jobs)
  132 jobs resolved (reason: link_left_site)
   19 jobs resolved (reason: stayed_on_site)
    6 jobs could not be resolved (reason: page_refused)
```

## A reason names why a job left the happy path

The reason is the value written to `Trace.reason`, so the summary and a database query call one population by one name.

A line describing the step's own success carries no reason clause. Succeeding is what the step is for, and naming a reason for it says nothing.

```
Promotion (61 jobs)
  61 jobs promoted into the pipeline
```

## A note is not a path

Anything true about the jobs rather than a way out of the step is a note. Notes sit after a blank line below the paths and never count toward the heading.

```
Classification (157 jobs)
   32 jobs expired (reason: past_expiry_threshold)
   64 jobs were close enough
   48 jobs too far (reason: no_location_match)
   13 jobs could not be judged (reason: location_unreadable)

  Note: 12 of these were also flagged as reposts
```

## A step that adds jobs says so

A step whose purpose is to bring jobs in from the database, rather than take them from the step before, carries a note. The run's running total grows there, and a reader following from collection has no other way to know.

```
Promotion (61 jobs)
  61 jobs promoted into the pipeline

  Note: these came from the backlog, not from this run's collection
```

## Sub-steps nest

A step that runs others carries them indented, and each follows every rule above.

```
Collection (7 sources)

  Adzuna (61 jobs collected)
    58 jobs kept
     3 jobs dropped (reason: no_company_identity)
```

## A step the run died inside says so

```
Classification (157 jobs) — stopped early
```

A partial block is otherwise indistinguishable from a complete one.

## The numbers come from trace rows

Every count is read back from the run's own `Trace` rows, never from what a handler returned. A count with no trace row behind it is not printed.
