# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Session Context** section for reasoning that isn't captured elsewhere. The decisions the user made are not in this document — read [the feature decision log](../docs/features/unified-pipeline/decision-log.md) for those.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

**Phase 10, Scoring, is built and closed. Nothing is in flight.**

Verified at session end: **121 test files, 2,706 tests passed, 17 skipped. `npm run lint` exits 0.**

The 17 skipped tests are skipped on purpose. They cover the fixture write this session disconnected, and they describe the behaviour a backlog item will restore.

Six commits pushed to `feature/unified-pipeline`, `4cda7fd..0ec2344`. The working tree holds one uncommitted line in the feature decision log, written moments before this document.

The next unit of work is **planning phase 11, Work log & enrichment**, following the [phase planning procedure](../docs/features/unified-pipeline/phase-planning-procedure.md).

## Completed This Session

**Phase 10's close, and one side piece of work.**

### The fixture write is disconnected

Two collectors read job cards off a rendered web page: Dribbble and UI/UX Jobs Board. Each saved a copy of that page into `lib/collectors/fixtures/` on every real job search, so an offline test could replay it. That dirtied the working tree on every search and asked for a commit after each one.

- The `writeFixture` call is commented out in `lib/collectors/dribbble.ts` and `lib/collectors/uiuxjobsboard.ts`, with its reasoning above it. The candidate is still picked, so reconnecting is uncommenting.
- Both test files mark their fixture-write `describe` block `.skip` rather than deleting it.
- Backlog item 26 was replaced. It is now **Live Collector Check & Fixture Refresh**, and its r&d file records what was withdrawn, the workaround until it is built, and the one tension it has to settle: a fast one-job run makes a thin, weak fixture.

### Phase 10 is closed

- **`architecture.md`** describes scoring as built: four new Status paragraphs, a three-command run-shape diagram, six new vocabulary terms, three new Parts rows, the board-row table in the Data Model, and a phase 10 row in Ported From Legacy.
- **The decision log** gained two entries.
- **Two backlog items retired.** Company Scoring Improvements and ATS Company Graduation moved to a new `docs/features/_cancelled/` folder. Items 8 to 29 renumbered to 6 to 27.
- **`docs/CURRENT-FEATURE.md`** has phase 10's 24 tasks folded back out and its close ticked.

## Session Context

The decisions the user made are in the feature decision log. **Two entries were written this session.**

### Calls made while building

**An unused import fails `npm run lint`.** Commenting out the `writeFixture` call meant commenting the import out too. This is why the disconnect touches the import line as well as the call.

**Stale phase references in `architecture.md` were corrected while there.** Three places still said work was coming that had already landed: the job service's "scoring joins it in later phases", and two "that is classification's call in Phase 9" notes. The phase-7a "will replace both orchestrators" sentence was rewritten to describe the two that exist.

**Both retired r&d files gained a "Cancelled" section.** The `retire-feature` skill does not ask for one. They exist because the user's own reason for choosing cancelled over completed was that a cold reader would otherwise think two features solved one problem — and a folder move alone does not say that.

**"Backlog item 26 was replaced" was dropped as a decision-log candidate.** It failed the "informs future work" test: `BACKLOG.md` and the r&d file already carry it.

### Gotchas discovered

**The link checker does not URL-decode.** `python3 ~/.claude/skills/retire-feature/scripts/check-links.py` reports 58 broken links under `docs/`. Almost all are `%26` in a path that really is `feature_r&d.md`. Three were real, caused by moving two folders one level deeper, and are fixed. **Do not treat the 58 as this session's damage.**

**`docs/DECISIONS.md` does not exist in this project.** The `start-work-session` skill asks a session to read it. There is one decision log, the feature's own.

**The Future Ideas list in `BACKLOG.md` restarts its numbering at 26**, colliding with the Upcoming Features numbers. Pre-existing and left alone.

### Approaches tried and abandoned

**Gitignoring the fixture files.** Rejected: `readFixture` throws when the file is absent, so a fresh clone's tests would fail until someone ran a real job search.

**Storing the fixtures in the database.** Rejected: they are test input, and the tests run with no database at all.

**Retiring the two backlog items with a supersession note at ship time.** This was proposed, matching how item 2 already says "retired once this ships". The user rejected it: "Remove both entirely."

### Open questions

**Phase 11 has two open questions in its r&d file**, both to be answered during planning. What "ask the user for the company name" means in each of the three places a status can change — the pipeline, the update-job skill, the Web UI. And whether a name the user supplies runs through company association's own match-or-create, or creates a company directly.

**Nobody owns the 58 pre-existing broken doc links.** Backlog item 17, Code Health, is the plausible home. Not raised with the user.

**A Workable parser is still unprioritized.** It cost 32 jobs in the first live run, more than any other platform. Carried from the previous hand-off.

## Next Steps

1. **Commit the one uncommitted decision-log line** in `docs/features/unified-pipeline/decision-log.md`, along with this hand-off.
2. **Plan phase 11, Work log & enrichment**, following the [phase planning procedure](../docs/features/unified-pipeline/phase-planning-procedure.md). Its [r&d file](../docs/features/unified-pipeline/phases/phase-11-work-log-r%26d.md) holds the scope, what ports from `legacy/` — `work-search-log`, `work-search-weeks`, `company-enrichment` — and the two open questions above. Phase 11 writes no traces: a status change made by hand is not a job passing through a step.
3. **Consider a parser for Workable.** A judgement for prioritization, not a decision already made.
