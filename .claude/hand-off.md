# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Session Context** section for reasoning that isn't captured elsewhere. The decisions the user made are not in this document — read the feature decision log for those.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

**Greenhouse Parser Reads Embedded Job Ids** is planned and unbuilt. Branch `feature/greenhouse-embedded-job-ids`, everything uncommitted. No code was written this session.

The feature teaches the pipeline to read a Greenhouse posting sitting on an employer's own website. Six employers do this — `brex.com`, `moduscreate.com`, `pinterestcareers.com`, `datavant.com`, `ats.comparably.com`, `gladly.ai` — and seven measured jobs were set aside unread because no reader owned those websites.

**Four tasks, none started.** They are in `docs/CURRENT-FEATURE.md` and in the spec.

1. A tool that turns a Greenhouse job number into its board name, by following Greenhouse's own redirect
2. The Greenhouse reader reads a link carrying a job number but naming no board
3. A reader can claim a link no website entry owns, and the Greenhouse reader claims job-number links
4. A command that returns set-aside Greenhouse jobs to the backlog once

**Test state:** 3,423 tests pass, 17 skipped, 169 files. Lint and type check clean. No unfixed failures.

### Modified files

- `docs/BACKLOG.md` — four features added at the top, 57 entries renumbered, then the first moved out to `CURRENT-FEATURE.md`, leaving 60. Header updated to name the active feature. Uncommitted.
- `docs/CURRENT-FEATURE.md` — holds the feature, its four documents, its four tasks. Uncommitted.
- `docs/features/greenhouse-embedded-job-ids/` — new. Holds `feature_spec.md`, `decision-log.md`, `feature_discovery.md`, `meeting-notes.md`. Untracked.
- `docs/features/multi-field-board-identity/`, `docs/features/ats-parser-expansion/`, `docs/features/general-purpose-parser/` — new, each holding `feature_discovery.md` only. Untracked.
- `docs/features/_cancelled/generic-fallback-parser/`, `docs/features/_cancelled/remaining-ats-parsers/` — moved here last session. Uncommitted.
- `docs/features/collector-parser-expansion/feature_r&d-draft.md` — untracked, carried from last session. Its first half is the agreed split; its second half is a superseded seven-feature proposal. The user asked for the file to be left as is.

## Completed This Session

1. **Wrote the four parsing features into the backlog** as entries 1 to 4, each with a `feature_discovery.md` carrying the measurements from the previous session's scoping work.
2. **Planned Greenhouse Parser Reads Embedded Job Ids in full** — spec, decision log, meeting notes, task list, feature branch.
3. **Traced the pipeline against the user's brain dump.** The user believed the parser, the promotion step and the collector all needed changing. Only the routing into the parser does.
4. **Tested all six affected employers live**, twice: what their Greenhouse link opens, and whether Greenhouse still holds the posting.
5. **Measured `absolute_url` across 1,744 postings on ten boards** while exploring a link-quality improvement that was then ruled out of scope.

## Session Context

**The decisions the user made are in [`decision-log.md`](../docs/features/greenhouse-embedded-job-ids/decision-log.md). Do not restate or re-litigate them.**

### One decision lives only in the meeting notes

The user declined to put the backlog naming decision in the feature decision log, on the grounds that it is not about this feature. It is recorded in `docs/features/greenhouse-embedded-job-ids/meeting-notes.md` under Decisions Made, marked as deliberately unlogged. **It will die when this feature ships.** The decision: the four new backlog entries use `feature_discovery.md`; the 44 older entries keep their `feature_r&d.md` links until the next audit.

### Findings verified by running code, not by reading it

- **The routing is the only hole.** `parserForUrl` in `lib/parsers/registry.ts` matches a link by the website its owner holds. `brex.com` matches nothing, so the job is set aside with the reason `no_parser_for_domain`.
- **Promotion and the collector need no edit.** `POLLABLE_COLLECTORS_BY_PARSER` in `lib/handlers/company-promotion.ts` already lists Greenhouse. A step named `post_parsing_association` already records a board name a reader found. The collector builds `boards.greenhouse.io/{slug}/jobs/{id}` itself, which the reader already reads.
- **A polled job already carries its board name.** `jobFieldsFromGreenhousePosting` in `lib/utils/greenhouse-fields.ts:57` writes `raw_company_slug`. The reader is simply never handed it — `ParserContext` is the link and nothing else.
- **Only three statuses file a work log entry** — `app. sent`, `screening`, `interview`, in `lib/utils/work-log-activity.ts`. A move to `backlog` files none, so the recovery task is silent by default.
- **All six postings are live in Greenhouse's own record**, each 5,000 to 11,500 characters. What varies is where each employer points its own link. Brex and Modus Create open the job page. Gladly opens a careers index. Comparably opens a data endpoint. Pinterest and Datavant both refuse a scripted request with a 403.
- **`absolute_url` is on every Greenhouse posting.** Measured on 1,744 postings across ten boards: present every time, carrying the job number every time, and pointing at the employer's own website 1,435 times.

### Gotchas

- **A formatter collapses indented continuation lines in `docs/CURRENT-FEATURE.md`.** Document links written as indented lines under the feature entry were merged into one unreadable line. They now sit under their own `## Documents` heading, which survives.
- **The 403s were never confirmed with a real browser.** Pinterest and Datavant refusing a scripted request looks like bot blocking, but that is a guess.

### Approaches abandoned

- **Rewriting a careers-page link during resolution** was rejected. The reason is in the decision log.
- **Using `absolute_url` as a job's saved link** was explored, measured, and then ruled out of scope. The user also declined to track it in the backlog, so **the measurement survives only in the meeting notes and the spec's out-of-scope note.**

## Next Steps

1. **Run `/start-work-session` and build task one** — the tool that turns a Greenhouse job number into its board name. The chain is in the spec: `boards.greenhouse.io/embed/job_app?token={id}` redirects to an address carrying `for={board}`. Per the naming rule a wrapper around something outside the app is a tool, so it belongs in `lib/tools/`. `lib/tools/board-employer-name.ts` is the closest precedent.
2. **Commit the documentation** before building, so the planning work is not mixed into the first code commit.
3. **Settle the other 113 stuck jobs.** This feature recovers only the jobs carrying a Greenhouse job number. The three sibling parsing features each target jobs already set aside, and none has a recovery task planned.
4. **Rescope the backlog entry Collector & Parser Expansion.** Its description still says it supersedes Remaining ATS Parsers, which was cancelled on 2026-09-20. Carried from the previous session and still not done.
