# Decision Log: Job Search Assistant

> Permanent record of durable architectural decisions for the Job Search Assistant

<!-- The global decision log holds decisions that reach beyond any single feature. -->
<!-- It is read before planning so settled architectural choices are not relitigated. -->
<!-- Feature-level decisions live in docs/features/{feature-name}/decision-log.md and die with the feature. -->

## Decisions

<!-- Flat, chronological list. Oldest first. -->
<!-- Each entry: date, then what was decided with enough context to understand why. -->
<!-- When a decision is superseded, replace the old entry entirely — new date, new text. -->
<!-- Entries are removed only when the thing they decided no longer exists and nothing replaced it. -->

- **2026-08-26** -- Every column in the database has one name, written `like_this`, and the code calls it by that same name. Prisma offers to give each column a second name for the code to use, and two names for one thing is a thing that can disagree with itself.

- **2026-08-30** -- No count is ever stored. Every number the app reports is worked out from the records when asked, because a stored total is a second version of the truth, and it can only answer the questions someone thought of the day it was built.

- **2026-09-06** -- A work log entry keeps its own copy of the employer name and the job title, and holds the job's identifier as plain text rather than as a link the database enforces. A work log entry is a Texas Workforce Commission filing that cannot be made again once its week has passed, so it must never depend on a row the app is allowed to delete.

- **2026-09-06** -- When two sources disagree about a job's details, the source priority list decides which one wins, and no rule in the code overrides it. A rule sitting above the list would make reordering the list appear to do nothing.

- **2026-09-17** -- A command that destroys data is stopped by the path it was given, never by what it finds inside. `npm run db:create` demands an explicit file and refuses the one named in `.env`, a dated copy is written before any allowed destruction, and schema changes go through `npm run db:migrate` instead.

- **2026-09-20** -- A reader is chosen for a job posting by the website its link sits on, and only a link no website entry owns is then offered to each reader to claim by recognising it. Checking the website list first stops a reader taking a link another reader owns: measured 2026-09-20, all 309 postings already on a Greenhouse address carry a job number that a claim would have matched.

- **2026-09-21** -- A job board whose identity takes more than one value is stored as one text value in the board table, its parts joined by a colon, and only that source's own code splits it apart. This keeps the table and every reader unchanged, so a new source needs no schema change.

- **2026-09-21** -- Two job links are matched by a key that keeps only the query values named in the identifying-values setting and drops every other one. One source carries a job's only identity in its query string while most carry throwaway tracking values, so a named list separates the two without naming a website in code.
