# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Decisions & Context** section for reasoning that isn't captured elsewhere.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

**Building phase 9. Tasks 1 to 12 of 19 are done. Task 13 is next.** The task list is in [`docs/CURRENT-FEATURE.md`](../docs/CURRENT-FEATURE.md) under "Build phase 9", and each finished one is ticked there.

The spec is [`phases/phase-09-classification-spec.md`](../docs/features/unified-pipeline/phases/phase-09-classification-spec.md). Read it before building anything — it holds the 121 criteria each task is built against.

Verified at session end: **2,431 tests pass across 105 files. `npm run lint` exits 0. Working tree clean. Eleven commits are unpushed.**

Every task followed the `crowd-code` process: a failing test first, then two sub-agents writing the same change in parallel, then one result picked or the two combined.

## Completed This Session

Twelve tasks, one commit each.

**The pieces the judging steps are built from.** A setting for the repost gap. Five new columns on a job. A table remembering every place looked up on a map. One age measurement. A splitter cutting a location into single places. A widened work-mode translator. A containment test. A geocoder and its test stand-in. A place service and its stand-in. The rule deciding whether a job is close enough.

**One existing step changed.** Normalization now cuts every location into places and lifts any work mode out of the text.

**Three new job lists** on the job service, one per judging step.

## Decisions & Context

### The user's decision

**Every code change goes through `crowd-code`, including small pattern copies.** Asked whether the two-writer tournament could be skipped for changes that only copy a pattern already in the file — a seven-line getter beside six identical ones. The answer was no. So a one-line addition to a test stand-in still went to two sub-agents.

### Names the plan described but did not give

The spec said what each column holds without naming it. These are the names chosen:

- `normalized_location_list` — the location cut into single places
- `location_match` — whether the job is close enough. Empty means no place could be read, which is a different answer from too far
- `location_match_place` and `location_match_mode` — which place and work mode won
- `is_repost` — whether the employer listed the role again
- `Place.lookup_text` — the text that produced a place, and its whole identity

### Calls made while building

**Where each new column sits in the merge.** The place list is contested between sources, beside the mode list it mirrors. The other four are written through, because classification owns them and a collector's fresh copy carries the key absent rather than null — so re-collecting a job cannot wipe its verdict.

**A reset keeps the place table.** A place costs a paced request and is not job data, so wiping it would make every reset expensive for nothing. `scripts/db-reset.test.ts` hardcodes the table list and was updated.

**The age measurement joined `lib/utils/job-age.ts`** rather than taking a new file. That file already reads "3 days ago" off a job card, which is the same subject seen from the collector's side.

**Age is an exact duration, not a count of calendar days.** The repost gap is explicitly a duration in the spec, and using one rule for both is simpler.

**The promotion list filters by age inside the service, not in the handler.** The spec's example summary shows promotion's heading equalling its promoted count, so the list handed to the step must already be only jobs it can promote. `findExpiredWithin(thresholdDays, now)` takes the run's date so the whole run measures against one moment.

**Normalization writes no success row for a location.** The spec's trace table names only `location_unusable`, and adding a success reason would change normalization's summary block, which is out of scope. `location_unusable` is a trace row only, not a user warning.

**The geocoder throws on a missing api key.** The old client logged and returned nothing, which made every job fail to classify silently. It also does not retry a refusal: a run resolving hundreds of places cannot afford to wait, and the place is tried again next run.

**The geocoder's pacing timer belongs to the geocoder, not the module.** The old one kept it in module state and needed a reset hook to be testable. This one does not.

### Gotchas that cost time

**`dev.db` is the old database with the old schema.** Its location column is `Job.location`, a plain string — not `raw_location_list`. It holds 2,202 jobs and 772 distinct location strings, which is what `lib/utils/locations.fixture.json` was built from. The 2,208 and 796 figures quoted in the spec come from the spike's own counting, not from this column.

**Two test suites running at once report a false error.** One run took sixteen minutes and ended with "1 error" and no detail. Run the suite once at a time.

**The Prisma client is generated to `generated/pipeline/client`, not `@prisma/client`.** Both sub-agents got this wrong on the place service and it had to be corrected by hand.

**A script using top-level `await` fails under tsx.** Wrap it in an `async function main()`. A script also has to live inside the repo for its imports to resolve.

**Two shell hooks block common shapes.** `sleep N; command` is refused — use `until <check>; do sleep 2; done`. And reading a file over 2048 bytes with `cat` is refused — use the Read tool or `sed -n 'START,ENDp'`.

### Sub-agent answers rejected, and why

**An index signature on the age type.** One writer added `[key: string]: unknown` so a test could pass an object carrying extra keys. That accepts any field at all. The test was fixed instead, to hold whole records in variables the way a real caller does.

**Throwing away a geocoded place missing its name or type.** One writer rejected any result without `addresstype` and `display_name`. Only the coordinates and the outline decide a match, so those are stored empty and the place is kept.

**Defaulting a missing collection date to now.** One writer did this in the job service stand-in, which would silently promote a job nothing is known about. It is left off the list instead.

### Still open

**Three checks the spec says must be run against the live map service, not in the suite.** That the service still returns an outline for a country, a state and a county. That the simplification really does shrink a country's outline. That the pacing holds across twenty lookups.

**The architecture doc is still stale**, deliberately. It updates at phase close, which is the box after "Build phase 9".

## Next Steps

1. **Task 13** — `lib/handlers/backlog-cleanup.ts` and its trace rows. Every backlog job is read, one past the age limit takes the status `expired`, the rest are untouched.
2. **Task 14** — `lib/handlers/promotion.ts` and its trace rows.
3. **Task 15** — `lib/handlers/classification.ts`: the repost check, then the age check, then the match, with one guard per job so a single failing lookup costs one job rather than the rest of the list.
4. **Tasks 16 and 17** — turn the user's location into coordinates once per run, and wire the three steps into the run with a save each.
5. **Task 18** — three summary blocks, to [`.claude/rules/run-summary.md`](rules/run-summary.md).
6. **Task 19** — this phase's vocabulary into the `Trace` comment, `trace-events.md` and the schema test.
7. **Close phase 9** — architecture doc, decision log, and any backlog change presented for approval.

**Two things to watch while building.** Nothing may read a row's own timestamp for an age or repost judgement. And `npm run test` must stay off the network — use `fakeGeocoder`.
