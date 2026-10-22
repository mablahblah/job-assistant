# Hand-Off

## Resumption Prompt

> You are resuming work on this project mid-task. Read this document fully before doing anything.
>
> 1. Read `CLAUDE.md` and `docs/APP.md` for project context and conventions.
> 2. Read the **Current Task** section below to understand what's in progress.
> 3. Read the **Session Context** section for reasoning that isn't captured elsewhere. The decisions the user made are not in this document — read the feature decision log for those. If a planning conversation was under way, read the meeting notes named in **Current Task** for how it got there.
> 4. Read the **Next Steps** section and confirm your understanding before proceeding.
>
> Do not re-discover what's already documented here. Ask if anything is unclear.

## Current Task

- **Feature:** Fantastic.jobs Collector, on branch `feature/fantastic-jobs-collector`. Spec: `docs/features/fantastic-jobs-collector/feature_spec.md`.
- **State:** every task is checked, in `docs/CURRENT-FEATURE.md` and in the spec's task list. The feature is ready for `/ship-feature`. The feature line in `docs/CURRENT-FEATURE.md` stays unchecked until it ships, per the backlog rule.
- **Expected Test Failures:** none. The section is empty.
- **Files, all uncommitted.** Nothing on this branch has been committed. This session changed `docs/architecture.md` only, plus the gitignored `docs/CURRENT-FEATURE.md` and the spec's last checkbox. The other tasks' files are as listed in the git status.

## Completed This Session

- **Task 11: `docs/architecture.md` updated.**
  - **New collector:** collector counts are now fifteen, with twelve marking jobs resolved. Added a `fantastic-jobs` paragraph, plus rows for the Apify runner, the last-success service and the `LastSuccess` table. Also added the step that records search times after the post-collection save, the polled-boards read on the ATS slug service, the four new settings, and the empty-search-terms refusal.
  - **Parser count:** now eleven dedicated parsers plus the general one. The parsing paragraph and the parsing handler row also now say what happens today: the general parser is the fallback, `unparseable` means no usable place, and only the general parser opens a browser.
  - **Link match key row:** now says the key keeps the query values named in the identifying-values setting.
- **Older stale facts in `docs/architecture.md` fixed after the task, at the user's word: "fix".**
  - The Status line now says phases 1 through 13.
  - Company promotion now names the ten pollable hiring systems, read from `lib/handlers/company-promotion.ts`.
  - The search-term analyzer row now names the ten ATS collectors as its callers.
  - The collectors' shared-helper list gained `search-term-analyzer` and `job-age`.
- **Checks.** Full suite: 4,473 pass, 17 skipped, none fail. Lint and the type check are clean.
- **Decision log:** nothing written. The user's one choice, "fix" over the backlog, failed the "commits to something" and "costly to undo" tests.
- **Feedback:** none.

## Session Context

- **Decisions:** in `docs/features/fantastic-jobs-collector/decision-log.md`. None were added this session.
- **Two corrections went past the task's three named items,** because they sat in sentences being edited. "The three ATS collectors" in the ATS slug service row became ten. The parsing handler's "Refuses" cell no longer says it refuses to guess at an unowned domain.
- **`last_success_save` was kept out of the Run Shape diagram on purpose.** That section says its nodes are the step vocabulary a trace event records, and this step writes no trace rows. It is described in the collection step's paragraph instead.
- **Open thread: the first real paid job search.** During this session the user ran a test job search in a different session. It was the first real run to send both paid Fantastic.jobs searches. Its results were not looked at here: what each search returned, whether either hit the 200-job cap, any errors or warnings, and the spend on the Apify account.
- **Gotchas, still true:**
  - `npx prettier --check` flags files, but Prettier is not a project dependency. Ignore it.
  - A database built by `db:create` + `db:seed` ranks sources differently from the real one. Flow tests whose outcome depends on a merge set `LIVE_RANKING`.
  - `vitest.setup.ts` blanks every `.env` key except the two database links. A test that starts a command must pass a key as an empty string, never delete it.
  - A schema change with no migration hangs the suite on `scripts/fantastic-jobs-setup.flow.test.ts`.
  - The full suite takes about 80 seconds.
  - Every real `npm run job-search` sends both paid Fantastic.jobs searches on the shared Starter Apify account, `mablahblah`.

## Next Steps

1. **Ask the user how the test job search went** before shipping. Their run summary shows the `fantastic-jobs` line, plus any Fantastic.jobs errors or warnings.
2. **Run `/ship-feature`.** At ship, `clean-decision-logs` copies this feature's decisions into `docs/DECISIONS.md`. That includes the empty-search-terms refusal, which replaces the second half of the 2026-08-27 unified-pipeline decision.
3. **After one week of normal job searches**, the user asks Claude to list the Fantastic.jobs jobs marked "too far", and decides then. This is the spec's "Written down, not guarded" item, and nothing prompts it.
