---
paths: ["lib/**/*.ts"]
---

# Part Ownership

## What is shaped to its source, and what is not

Collectors and parsers are the only app code written to fit a particular job site. Every other part acts on a job's data alone and cannot tell where that job came from. A test stand-in, the fake that plays an outside site during a test, may copy that site's real reply format.

No part branches on which collector produced a job.

## What exists exactly once

Seven tasks have one implementation each, identical wherever they are called. A second implementation is a defect, not a variation.

Removing duplicates. Saving and updating. Following a job's link to its source. Tidying names into a consistent form. Matching a location against the user's own. Clearing out the backlog. Recording what happened.

## No part assumes it is inside a job search

The same saving code is called by a job search, by a status change made by hand, and by scoring. Nothing depends on a run identifier, on being partway through a list, or on another part having run first.

A caller hands down whatever context a part needs, including which step to record against.

## Each stretch of the pipeline ends at the database

A stretch writes its results and stops. The next one starts by asking the database for the jobs carrying the right marker, the yes-or-no flag that records which steps a job has finished. A job search asks for every such job, whenever it was collected. A run handed particular jobs narrows that question to those jobs' identifiers, and takes nothing else from what the stretch before it returned. A step the orchestrator, the code that calls each step in order, runs on its own straight after a stretch's save belongs to that stretch, and may use what that stretch returned.

## Where new behaviour goes

| Part | Owns | Never does |
|---|---|---|
| **Collector** | Gathers raw jobs and every field its source hands over for free. Writes each into a `raw_` field, a column that keeps a value exactly as the source published it. Reads its source's own conventions, the meaning the source gives its own fields, and sends the user's search settings with its request so the source filters before it answers. | Interpret a job's content. A figure it had to read out of prose is not free data. |
| **Normalizer** | Reshapes raw data that is already there into the fields that matter. | Go looking. A `raw_` field that is empty stays empty. |
| **Resolver** | Follows a job's link to the employer's own posting. | Read anything off the page it lands on. |
| **Parser** | Makes the final attempt at filling `raw_` fields, including reading a salary or a way of working out of the job description. | Format what it extracts. It hands its findings back to the normalizer. |
| **Company association** | Decides which employer a job belongs to, and creates one where none exists. | Invent a name from a board slug, the short name a hiring site gives an employer's job board, or a slug from a name. |
| **Dedupe** | Reduces the job list, using whichever identity tests, the checks that decide two records are one job, have all their fields on both sides. | Merge two jobs when no test has the fields it needs. |
| **Save** | Creates, updates and deletes rows, and owns the merge rule every caller shares. | Decide which employer a job belongs to. |
| **Classification** | Judgements about the job — is its location a match, has it expired. | Reshape a value, or go looking for a missing one. |
| **Scoring** | Alignment, the score for how well a job fits the user; employer scores; and promoting an employer to be watched directly. | Reach the database except through the services that own each table. |
| **Backlog cleanup** | Expires a backlog job once it passes the age limit, measured the way classification measures it. Empties an employer's scores once they pass their own age limit, and its guessed scores sooner. Guessed scores are the ones the scoring agent set with no public evidence behind them. | Delete a job or an employer. |

## Who sets a status

A step sets only the status that names its own outcome. Resolution sets `unresolvable`. The parser sets `unparseable`, or `expired` for a dead page. Classification sets `too far`, or `expired` for an old posting. Backlog cleanup sets `expired`. Promotion and letting an added job through set `backlog`. A status change by hand sets the status the user chose.

## The test that separates reshaping from going looking

Reshaping changes a value that is already there. Going looking produces one that is not. If a field is empty and something has to go and find it, that is a parser's job wherever it happens.
