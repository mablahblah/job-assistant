# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Decisions & Context** section for reasoning that isn't captured elsewhere.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

Feature: **Unified Job Pipeline** — a long-lived branch, `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 6, Dedupe, is mid-planning.** Five of fourteen phases are closed. Phase 6 is at step 3 of the [phase planning procedure](../docs/features/unified-pipeline/phase-planning-procedure.md), inside `build-requirements`.

**All eight stress-test problems are settled.** So is the first of the nine loose decisions, apart from one half of it.

**The exact resume point: the open half of loose decision 1.** A job's link lookup names one stored job and its company-and-title lookup names a different one, and those two do not match each other. Either fold all three into one, or stop at the link because it is the one there was proof for. Claude leaned towards stopping at the link, on the grounds that folding lets an inference destroy a job the proof said nothing about.

**Three files are uncommitted**, all documentation: the previous hand-off, one decision log entry, and the fourteen draft stories the user restored into the phase 6 r&d.

**Four commits pushed this session:** `07420ce`, `3d54109`, `c96e2bb`, `277a228`.

**Verified fresh before committing.** `npm run lint` exits 0. `npm run test` exits 0 with 1,545 tests across 56 files.

## Completed This Session

**Stress-test problems 2 through 8, all settled and recorded**, each verified against the code rather than taken on the agent's word. Problem 5 turned out to be a logged decision from 2026-09-06 whose ground had moved, and it was revisited rather than fixed. Problem 8 was settled alongside it, both being the same gap: save is asked to delete a row and two of its four outcomes write nothing.

**A negative match rule, the user's own idea.** The company-and-title clause does not fire where both jobs carry a resolved link, those links share a host, and their keys differ. Two posting ids on one board are two openings at that company.

**Thirteen decisions logged, one superseded.** The 2026-09-07 entry claiming which id rides along changes no data is gone, replaced by two entries split by whether a row exists.

**`docs/features/unified-pipeline/trace-events.md` created** — the whole trace vocabulary as tables, one per step, with what happened to the job in plain words. It is a reference. The schema comment stays authoritative.

**`CLAUDE.md` gained RULE #1**, written by the user: no shorthand, layman's terms.

## Decisions & Context

**Thirteen decisions are in the feature decision log dated 2026-09-09.** They are not repeated here.

### The user's model, which settled several of the problems

A job list entry is a reference to its database row, not a second copy of the job. The work done on it tells that row how to update. So deduping an entry against its own row compares a job with itself.

### Approaches tried and refused, so they do not come back

- **Fixing the self-delete by skipping only the entry's own id.** One entry could still claim another entry's row.
- **Computing the two link keys at each write site**, the way `company-service.ts` does. Two places that drift. The company service only splits them because its two paths write different shapes.
- **Storing the whole losing job in a trace `detail`.** More than would ever be read; four identifying fields cover it.
- **Picking the oldest match and warning when a lookup finds several.** It walks away from duplicates the run had just proved exist.
- **Asking the database before comparing the list.** Every duplicate would pay for its own lookup, then be whittled down anyway.
- **`db_delete_failed` as an event name.** Nothing failed, and it breaks the `job_dbrow_*` pattern its four siblings follow.

### Gotchas found this session

- **`grep -r --include=*.ts` fails in this shell.** The pattern needs quoting: `--include="*.ts"`.
- **The r&d did not say who writes the trace row for a job leaving the list.** Line 161 reads as dedupe's, line 169 says save's. Only save's works, because save has no other way to know why it is deleting. That ambiguity made this whole area slippery.
- **`cat` is still blocked on any file over 2048 bytes** by a hook. **The commit hook prints a graph analysis block** on every commit; harmless.

### Carried forward, still true

**Dedupe does not exist yet**, so two runs write two rows for one posting. **`pipeline.db` holds 0 jobs.**

**Anything new under `lib/steps/` loads two rules** — `.claude/rules/pipeline-steps.md` and `.claude/rules/naming.md`. **Anything touching `lib/collectors/registry.ts` loads a third**, `.claude/rules/source-registry.md`. **A `BACKLOG.md` change needs the user's approval before it is written.**

**Vitest swallows `console.log` here** — write probe output to a file. **These test files import `test`, not `it`.** **Vitest output carries ANSI codes** — strip with `sed -e 's/\x1b\[[0-9;]*m//g'`. **`npx tsx -e` cannot run top-level `await`.** **`PIPESTATUS` does not survive** — use `cmd > file 2>&1; echo $?`.

### The eight decisions still loose

1. Which field decides "older survives" — `created_at`, `collected_at`, or list order.
2. Whether two list entries that both already carry a row fold into one or produce a delete. Today's decision to keep the list compare first sharpens this: a job pulled in from the database is compared only against the entry that found it, so two entries reaching one row through different clauses can both claim it.
3. Which collector goes on the `added_to_job_list` row — the one that first found the stored job, or the one that matched it today.
4. In a chain of three or more, whether a losing job names its immediate partner or the final survivor.
5. What happens when dedupe's own database read throws. Save has a pattern at `save.ts:120`; dedupe has none.
6. How to prove an index exists in a test. This would be the schema's first non-unique index.
7. Which dates feed the 24-hour test when a job already carries both a posted and an updated date.
8. How a three-or-more-way merge breaks a tie, since "the later side wins" only settles two. Now live, because a lookup returning several rows folds them all.

### Six to log rather than solve

1. A job that finishes parsing never enters a dedupe list again, so a duplicate that slips through is permanent.
2. A job pulled in from the database is never compared against the rest of the list.
3. Chaining pools dates before the database pass runs, widening the range that pass sees.
4. The collector checklist line the r&d promises does not exist in `.claude/rules/source-registry.md`.
5. `absoluteUrl` in `lib/collectors/dribbble-cards.ts` mishandles a `//host/path` link. Unrelated to dedupe.
6. The metric says jobs "deleted" for hard-matching, while most first-pass losers are "abandoned" instead.

### Open questions

1. **The live pipeline database is still on the old schema.** Rebuilding is `npm run db:create` then `npm run db:seed`. **The user has been asked six times across sessions and has not answered.**
2. **Whether Phase 11a wants a database reset of its own.** In the phase 11a r&d.
3. **Two backlog candidates await approval** — the Dribbble protocol-relative link bug, and the collector checklist line.

## Next Steps

1. **Settle the open half of loose decision 1**, described at the top of this document.

2. **Settle the eight remaining loose decisions**, listed above. Most are one line each.

3. **Put the six log-and-move-on items and the two backlog candidates to the user**, then invoke `add-to-backlog` for whatever they approve. `BACKLOG.md` is never written without their say-so.

4. **Rework the fourteen draft stories and get them approved.** They are in the phase 6 r&d under "Draft user stories". Two jobs there. Story 5's stated reason is dead — it says the key columns are non-unique so jobs sharing a careers page can be saved, and resolution no longer writes a careers page. The live reason is that two rows for one posting share a key until the pass that collapses them, and a blocked merge leaves that pair standing for good. And roughly nine stories are missing, one per decision settled on 2026-09-09.

5. **Write acceptance criteria** — `build-requirements` Phase 5, which has not started. The `feature-specs` rule sets their shape and loads once the spec file exists.

6. **Write `phase-06-dedupe-spec.md`** beside the r&d: What We're Building, User Stories, Edge Cases, Acceptance Criteria, Tasks, Approach. Phase 5's spec is the closest model. Then run `spec-review` on it.

7. **Tick "Plan phase 6" in `docs/CURRENT-FEATURE.md`** and put the phase's task list under its build item.

8. **Invoke `wrap-up-planning`**, scoped to Phase 6.
