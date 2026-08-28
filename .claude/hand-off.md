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

Feature: **Unified Job Pipeline** — thirteen phases on the long-lived branch `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 1 (Collection) is building. Tasks 1 through 12 are done; four remain.** The next unchecked item in `docs/CURRENT-FEATURE.md` is **task 13, taking parsing and name shaping out of the collectors**.

The spec is `docs/features/unified-pipeline/phases/phase-01-collection-spec.md`. Read it with `phase-01-collection-r&d.md` beside it. It keeps **two parallel numbered lists** — User Stories 1–78 and Acceptance Criteria 1–103. A reference like "AC 33" always means the criteria list. Confusing the two is how four stale criteria once survived an audit.

**Working tree is clean and pushed through `e1e6ca1`.** Nothing is in flight.

## Completed This Session

**Task 12 — the raw fields carry one prefix.** `company_name`, `original_title`, `original_location_list`, `original_mode_list` and `salary_raw` became `raw_company_name`, `raw_title`, `raw_location_list`, `raw_mode_list` and `raw_salary`. `raw_salary` is a `Json` column holding a fixed five-key envelope. `raw_company_slug` was added as a column that nothing writes yet. `original_url`, `resolved_url` and `description` keep their names — a URL is not the source's wording, and a description is an input to normalization rather than a subject of it.

Every collector writes the envelope instead of `salary_low`, `salary_high` and `salary_period`. Greenhouse and Lever stopped reading a salary out of the description, which task 13 had been carrying.

**Documentation caught up with the decisions.** AC 81 was rewritten — it said the collector converts cents, which is the opposite of what was settled. AC 103 was added for the envelope. Tasks 12 and 13 were rescoped in the spec. Two entries went into the decision log, and the Phase 3 r&d gained the envelope table and the conversions that phase now owns.

**Verified:** `npx tsc --noEmit` exit 0. `npm run lint` exit 0. `npm run test` exit 0 with 765 passing across 29 files. `npm run db:create` and `npm run db:seed` both exit 0, `dev.db` byte-identical afterwards, and the rebuilt `Job` table carries all six renamed columns with `raw_salary` as JSONB. The cents handling and the figure gate were each broken on purpose to confirm the new tests catch them — 3 failed, 81 passed — then restored.

## Decisions & Context

All signed-off decisions are in `docs/features/unified-pipeline/decision-log.md` — read it, it is the authority. Two were added this session, on the envelope's fixed keys and on collectors recording a unit rather than converting.

**The `raw_salary` envelope.** Five keys, the same whatever the source, each holding the source's own value untouched, and a key the source said nothing about is absent:

| Collector | Writes |
|---|---|
| Adzuna | `{ salary_min, salary_max }`, only where `salary_is_predicted` is `"0"` |
| JSearch | `{ salary_min, salary_max, salary_period: "YEAR" }` |
| Greenhouse | `{ salary_min: 14000000, salary_max: 21000000, salary_currency: "USD", salary_unit: "cents" }` |
| Lever, Dribbble, uiuxjobsboard | nothing — no `raw_salary` key at all |

**Constraints and gotchas:**

- **JSearch sends an explicit `null`**, not an absent key, on a posting with no pay — 8 in 10. `JSearchJob`'s three salary fields are typed `| null` because of it, and a check for `undefined` alone would let a null through into a typed `number`.
- **A period with no figures behind it is not a salary.** The envelope is written only where `salary_min` or `salary_max` is present. Both crowd-code agents got this wrong and would have stored `{ salary_period: "YEAR" }`, handing normalization an envelope with nothing to normalize.
- **`company_name` is also Greenhouse's own API field**, at `GreenhousePosting.company_name` and `matched[0]?.company_name`. A repo-wide rename corrupts both. It has to be done file by file.
- **`normalizeSalary` has no callers and is not dead.** Reusable code gets unhooked, not deleted. Phase 3 extends it — it needs cents handling, Ashby's `"1 YEAR"` (`RECOGNISED_PERIODS` matches a lowercased word exactly, so `"YEAR"` passes and `"1 YEAR"` returns undefined), and the envelope keys. Its text output, `buildSalaryRaw`, has no column to land in and retires there.
- **AC 82 and 83 are tested in `lib/salary.test.ts`**, against the util directly. The collector-level copies were deleted without losing coverage. Same for AC 86 and 88.
- **`prisma.config.test.ts` flakes under load.** The first test pays a 338ms cold import of the config's module graph; every other test in the file costs 2ms. It failed once at vitest's default 5000ms ceiling during a run with 19.58s of import contention, and passed in a 4.91s one. The fix is a `CONFIG_LOAD_TIMEOUT_MS` constant passed per test, matching the `CREATE_TIMEOUT_MS = 45_000` pattern already in `schema.test.ts`. Not raising `testTimeout` globally — that hides real hangs.
- **`crowd-code-writer` agents have Read, Grep and Glob only — no shell.** Snippet-sized briefs work; both rounds returned in 11s to 165s. **Their output still arrives HTML-escaped** — `&lt;`, `&gt;`, `&amp;` — from both agents on both rounds. Unescape before applying.
- **A `for f in $files` loop passed every filename to `sed` as one argument.** Use `while IFS= read -r f`.
- **The commit hook flags `toJobListEntry` and `cardToJob` as untested.** Neither is exported, so the graph cannot see the tests reaching them through `collect`. False positive.

**Reversed during the session, so it is not re-litigated:**

- A common `{ low, high }` envelope was proposed and rejected. The keys are fixed `salary_*` names; the values are verbatim; the normalizer reshapes.
- The collector converting Greenhouse's cents was proposed on the strength of AC 81 as written. AC 81 was wrong and was rewritten.
- Deleting `normalizeSalary` and withdrawing AC 82/83 was proposed and reversed.

**Open questions:**

- Whether the `prisma.config.test.ts` timeout goes to the backlog.
- Whether "reusable code is unhooked, not deleted" should be written as a rule in `~/.claude/rules/` or `CLAUDE.md`. It is a general working principle rather than a Phase 1 decision, which is why it is not in the feature decision log.
- The Phase 4 and Phase 3 questions carried from the last session, all recorded in their phase r&d files: whether Association's two passes differ, whether JSearch's employer name can be trusted for a match, whether a slug match should correct a stale seeded name, and what normalizing a title actually does.

## Next Steps

1. **Task 13 — take parsing and name shaping out of the collectors.** Greenhouse and Lever stop reading a work mode out of the description; the salary half is already done. Lever stops fetching its board page to read the employer name out of the HTML `<title>`. `nameFromBoardTitle` and `nameFromSlug` stop running at collection. Lever writes `raw_company_slug` alone and leaves `raw_company_name` empty. The utils and their fixture stay for Phase 8. AC 27, 29, 31 and 36 describe the behaviour being removed and are withdrawn or rewritten with it. — AC 100–102
2. **Task 14 — build the Ashby collector.** Last, deliberately, so it is built once against rules that have stopped moving. `isListed` filter, `raw_company_slug` only, and the salary is the `summaryComponents` entry whose `compensationType` is `"Salary"` — not the first entry, which is equity. Its envelope is `{ salary_min: minValue, salary_max: maxValue, salary_period: "1 YEAR", salary_currency: "USD" }`, with no `salary_unit` because Ashby sends whole dollars.
3. **Task 15 — wire the `job-search` skill.** One step that runs the orchestrator and surfaces errors and warnings first.
4. **Task 16 — live one-job command.** Outside the default suite, no fixture written.
5. Then **Plan phase 2 — Tracing**, following the phase planning procedure.
