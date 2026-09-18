---
paths: ["lib/**/*.ts"]
---

# Part Ownership

## What is shaped to its source, and what is not

Collectors and parsers are the only code written to fit a particular job site. Every other part acts on a job's data alone and cannot tell where that job came from.

No part branches on which collector produced a job.

## What exists exactly once

Seven jobs have one implementation each, identical wherever they are called. A second implementation is a defect, not a variation.

Removing duplicates. Saving and updating. Following a job's link to its source. Tidying names into a consistent form. Matching a location against the user's own. Clearing out the backlog. Recording what happened.

## No part assumes it is inside a job search

The same saving code is called by a job search, by a status change made by hand, and by scoring. Nothing depends on a run identifier, on being partway through a list, or on another part having run first.

A caller hands down whatever context a part needs, including which step to record against.

## Each stretch of the pipeline ends at the database

A stretch writes its results and stops. The next one starts by asking the database for every job carrying the right marker, whenever it was collected. No stretch reads what the one before it returned.

## Where new behaviour goes

| Part | Owns | Never does |
|---|---|---|
| **Collector** | Gathers raw jobs and every field its source hands over for free. Writes each into a `raw_` field exactly as it arrived. | Interpret anything. A figure it had to read out of prose is not free data. |
| **Normalizer** | Reshapes raw data that is already there into the fields that matter. | Go looking. A `raw_` field that is empty stays empty. |
| **Resolver** | Follows a job's link to the employer's own posting. | Read anything off the page it lands on. |
| **Parser** | Makes the final attempt at filling `raw_` fields, including reading a salary or a way of working out of the job description. | Format what it extracts. It hands its findings back to the normalizer. |
| **Company association** | Decides which employer a job belongs to, and creates one where none exists. | Invent a name from a board slug, or a slug from a name. |
| **Dedupe** | Reduces the job list, using whichever identity tests have all their fields on both sides. | Merge two jobs when no test has the fields it needs. |
| **Save** | Creates, updates and deletes rows, and owns the merge rule every caller shares. | Decide which employer a job belongs to. |
| **Classification** | Judgements about the job — is its location a match, has it expired, what status does it take. | Reshape a value, or go looking for a missing one. |
| **Scoring** | Alignment, employer scores, and promoting an employer to be watched directly. | Write to the database directly. It hands results to the same saving code every other part uses. |
| **Backlog cleanup** | Clears out old jobs and employers on the same ageing rules classification uses. | Remove an employer that holds a board slug. |

## The test that separates reshaping from going looking

Reshaping changes a value that is already there. Going looking produces one that is not. If a field is empty and something has to go and find it, that is a parser's job wherever it happens.

## Direction of dependency

A plain function depends on nothing above it. It never names a file in `lib/handlers/` or `lib/orchestrators/`, type-only imports included.

A shape two folders share lives in `lib/types/`.
