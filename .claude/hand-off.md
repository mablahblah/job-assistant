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

**Phase 3 (Normalization) is being built.** Tasks 1, 2 and 3 of 12 are done. Task 4 — the title normalizer — is next and is the first point where real before/after output exists to look at.

**Tasks 1 and 2 are committed and pushed.** Task 3 is complete and uncommitted: four modified files, 954 tests passing, lint clean.

Modified and uncommitted: `lib/settings-service.ts`, `lib/settings-service.test.ts`, `scripts/db-seed.ts`, `scripts/db-seed.test.ts`, plus one decision-log entry added during hand-off.

## Completed This Session

**Task 1 — Schema.** `Job` gained `title` and `normalized_mode_list`; `Setting` gained `title_head_nouns`, `title_levels`, `title_suffixes` and `title_removal_words`. `normalized_mode_list` joins the `Omit<>` union on `JobListEntry` so it types as a string list rather than Prisma's `JsonValue`. Commits `cb7f508` and `eacda7f`.

**Task 2 — The company-name fixture.** `lib/company-names.fixture.json`, 1,324 distinct names read from `dev.db` through a read-only connection, hashed before and after to prove the live database was untouched. Kept as published rather than cleaned: 9 names carry untrimmed whitespace, one has an internal double space, 68 end in punctuation. Commits `19c8b85` and `fc8cf9b`.

**Task 3 — Vocabulary settings.** Four getters on `SettingsService`, seeded defaults, and validation that throws on missing, empty, or wrong-typed rather than degrading silently. 28 new tests, 926 to 954.

**Three decisions logged**, all signed off in conversation: trailing punctuation on a company name is dropped including the period on `Inc.`; a type-shaped acceptance criterion is proven by a runtime test; and a vocabulary is seeded short and grows from real output.

## Decisions & Context

The decision log is the authority. What follows is only what is not written down elsewhere.

**Constraints that are not recorded in any spec:**

- **`contractor` must never join the removal list.** AC 22 requires `UX Designer, Contractor` to keep `Contractor` as its team. Adding it would break an agreed criterion.
- **The clearance words are the biggest removal candidates and the wrong tool.** `clearance` appears 42 times in the 627-title fixture, `secret` 9. Removing them makes output worse — `TS/SCI Clearance Required` becomes `Required`. The problem is the phrase, not the word. Revisit at task 4 with real output in hand.
- **`remote` is off the removal list,** so real titles like `Lead Product Designer, Remote` will store `Remote` as their team. ACs 6 and 7 still hold because both name `Remote` on the list as their own precondition — the normalizer takes its vocabularies as an argument, so tests supply their own.

**Gotchas hit this session:**

- **A test that passes on its first run proves nothing.** The seed's overwrite guard needed removing on purpose to prove the test could fail. It also caught an existing `modified_at` test, so an unnecessary write is caught two ways.
- **A crowd-code prompt is not a source.** The prompt for the getter tests listed helper names that do not exist in `settings-service.test.ts`. One writer read the file instead of trusting the prompt and used the real ones.
- **A sub-agent's expected values can be stale.** Both writers seeded nine suffixes and a four-word removal list, correct against the r&d and wrong against decisions made minutes earlier.

**Approaches tried and abandoned,** each with its measurement now in the phase 3 r&d:

- **A `typecheck` script.** `tsc --noEmit` does not catch a missing `Omit<>` override — verified by removing one and typechecking clean.
- **`expectTypeOf` type assertions.** A no-op at runtime; in an ordinary `.test.ts` it passes while proving nothing.
- **Pointing vitest's typecheck at every `.test.ts`.** Works, but collects each file twice — `lib/salary.test.ts` alone reports 81 tests ordinarily and 128 under typecheck, so the suite's count stops meaning anything.
- **An eighteen-word removal list** drafted from the fixture, and **nine suffixes** from the r&d. Both cut to the short lists.

**Open threads:**

- **`entry` is now in no vocabulary at all.** Dropped rather than mapped to `Intern`, because an entry-level role is not an internship. A title reading `Entry Level Product Designer` gets no level. Needs the user's eye.
- **The level mapping is a reconstruction.** The r&d gives 16 spellings and 12 stored forms but never pairs them. `senior`/`sr`/`sr.` to `Sr.`, `junior`/`jr`/`jr.` to `Jr.`, `associate`/`assoc` to `Associate` are plainly spelling variants. Nothing in a document confirms them.
- **`sr.` and `jr.` were added to their match lists by inference** from AC 18, which requires `Sr`, `Sr.` and `Senior` to store identically.
- Carried from previous hand-offs, none blocking: the coverage figures in the phase 3 r&d are stale; the four silent source assumptions in the Phase 1 r&d are still unguarded; Phase 2's AC 15 printing half still has no standing test; the no-overfitting decision is rule-shaped and may belong in `docs/DECISIONS.md`; there is no `salary_currency` column and a non-USD figure is indistinguishable from dollars.

## Next Steps

1. **Commit task 3.** Four modified files plus the decision-log entry. Nothing else is outstanding.
2. **Build task 4 — the title normalizer.** A pure function taking its vocabularies as an argument, opening no database. The eight-step rule is in the phase spec; ACs 1 to 37 are the test list.
3. **Print every title's before and after** against `lib/ux-titles.fixture.json` and read it, rather than asserting a coverage figure. AC 53, and the user asked for this explicitly at planning.
4. **Bring three things back to the user from that output:** whether `Remote` surviving as a team item bothers them, whether the clearance phrases need handling beyond word removal, and whether `entry` should exist as a level.
5. **Re-measure the stale coverage figures** in the phase 3 r&d once the real rule runs. They were taken with an abandoned stop list.
6. Every task is test-first; `test-driven-development` runs before implementation, and `crowd-code` produces the code.
