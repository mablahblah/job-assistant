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

**Phase 9 is planned. Nothing is built. The next box is "Build phase 9" and its 19 tasks are listed under it in [`docs/CURRENT-FEATURE.md`](../docs/CURRENT-FEATURE.md).**

Verified at session end: **2,229 tests pass across 97 files. `npm run lint` exits 0. Working tree clean. Nothing unpushed.**

Four commits went up this session, plus the three phase 8a commits the previous session left behind.

The spec is [`phases/phase-09-classification-spec.md`](../docs/features/unified-pipeline/phases/phase-09-classification-spec.md) — 30 stories, 20 edge cases, 121 acceptance criteria, 19 tasks. **The r&d beside it no longer holds a second copy of the criteria.** It points at the spec, because the two had already diverged at 116 against 121 with different wording. The spec is the record; the r&d holds the reasoning, every finding raised and dropped, and what each grading pass changed.

## Completed This Session

Planning only, end to end: brain dump, orientation, discovery, two spikes, 30 stories, two stress-test rounds across six sub-agents, six user decisions, a rubric grading, a coverage audit, two `spec-review` passes, the spec, meeting notes, 27 decision log entries, and eight out-of-scope items placed one at a time.

**Two spikes are committed and rerun offline** at [`location-research/spike2/`](../docs/features/unified-pipeline/location-research/spike2/), with their own README and two geocode caches. `split.ts` is the shape task 5 builds from. Every measurement quoted in the spec comes from there.

**A new project rule**, [`.claude/rules/run-summary.md`](rules/run-summary.md), governs every run summary from now on.

**Two global files changed.** `~/.claude/rules/feature-specs.md` gained a "Naming things in a criterion" section. `~/.claude/references/rubrics/spec-rubric.md`'s implementation-detail check became "Words before names". Both were the user's call, and both change how any future spec is written and graded.

## Decisions & Context

### The invariant that matters most

**Expiry, promotion and the repost test read the posting's own dates and never the row's timestamps.** The user caught this and nothing had tested it. A rule reading the row's timestamp would promote every job the moment its own status was written — writing the status moves the timestamp, which qualifies the job for promotion, forever. Criteria 120 and 121 guard it.

### Proven, and deliberately not fixed

A job a source lists again has all three phase marks cleared and goes round the pipeline again — a browser visit, a page fetch, a fresh judgement. Proven by running `mergeJobs` directly. Every collector writes the marks as false and the merge takes the newer value.

**The user judged this the system working, not a defect.** A job that may have changed should be read again. Reducing what an unchanged job costs is backlog item 29.

### What was measured rather than argued

Six questions were settled with numbers instead of debate, and each is reproducible:

- Cutting a location at every delimiter gains 32 matches and loses none across 2,208 jobs.
- Of 796 fragments, ten landed within thirty miles — every one a real Austin-area place. The feared false local signal never appeared.
- Comparing place names put a job in Austin, Arkansas into the backlog. That is why containment became geometry.
- Places repeat at 80%, so the cache earns its place.
- Keeping the spike's place-and-mode pairing changes no verdict on any real job.
- Adding distance to the remote test gains exactly one job and no false match.

### Left stale on purpose

**The architecture doc.** Its run diagram has no promotion step, and it says a fourth save point arrives with classification when Phase 9 adds two. The user's call: updating it now is getting ahead of ourselves. It updates at phase close.

**The four existing summary blocks.** Phase 9 builds three new blocks to the new rule while collection, dedupe, resolution and parsing keep the old shapes, so a run prints two shapes side by side until backlog item 30 is done. Not only formatting — those four write no trace row when a job passes through untouched, so their headings have nothing to count.

### A gotcha that cost time twice

**A markdown formatter collapses indented code blocks onto one line** in this repo's `.claude/rules/`. It destroyed the examples in the run-summary rule on first write. Fenced blocks survive; indented ones do not.

## Next Steps

1. **Build phase 9.** 19 tasks in `docs/CURRENT-FEATURE.md`, in order. Task 1 is the repost gap setting, task 2 the five new job columns. Each task is one unit of code with its tests.
2. **Watch two things while building.** Nothing may read the row's timestamp for an age or repost judgement. And `npm run test` must stay off the network — the geocoder needs its fake before any test touches it, which is task 9.
3. **Close phase 9** when it is built: architecture doc, decision log, and any backlog change presented for approval. The architecture doc's two known staleness points are listed above.
