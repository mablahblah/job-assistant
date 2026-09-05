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

Feature: **Unified Job Pipeline** — a long-lived branch, `feature/unified-pipeline`. Job searches run from `main`, where the old pipeline still works.

**Phase 4, Company Association, is being built. Tasks 1 to 7 of 13 are done.** Nothing is in flight. The next item is task 8, the seed.

Five commits are pushed, ending at `8b4b6be`. **Two files are modified and uncommitted:** `docs/features/unified-pipeline/decision-log.md` and `docs/features/unified-pipeline/phases/phase-04-company-association-spec.md`, holding this session's three decision entries and eight build calls.

The suite runs **1,303 tests across 47 files**, up from 1,215. `npm run lint` exits 0 and runs `tsc --noEmit` after ESLint. No job site was reached. No test fixture changed.

## Completed This Session

**The vocabulary.** "Store" is retired. A reusable piece built from the database connection is a service; a plain function that reaches no database is a util. Both are defined in `CLAUDE.md` under Terminology. `architecture.md`'s table gained a Kind column marking each part Service, Step or Util — four of its six rows were not services. The feature spec's six "single services" became "single shared implementations", because name normalization is a plain function.

**Task 4 — the company service.** `lib/company-service.ts` owns every read and write of `Company`: look up by slug, look up by match key, create, fill an empty name. A write the database refuses is recovered rather than thrown, by looking the blocker up across all three unique columns. 16 tests against a real scratch database.

**Task 5 — its fake.** `lib/company-service.fake.ts` backs the same interface with a plain array the caller hands in and reads back. It holds state, unlike `settings-service.fake.ts`, because criterion 31 needs job 2 to find what job 1 created. Its 19 tests deliberately mirror the real service's, so drift fails rather than lies.

**Task 6 — the clash warning.** `lib/association-warnings.ts` turns each warning into one line and never folds. 12 tests.

**Task 7 — the step.** `lib/steps/company-association.ts`, 205 lines. 41 tests across `company-association.test.ts` and `company-association-events.test.ts`.

## Decisions & Context

The decision log is the authority. Three entries were added on 2026-09-05: the service/store vocabulary, the service reporting a refused write rather than throwing, and recovery covering all three unique columns. The eight calls made while building are in the phase 4 spec's Approach section. What follows is only what is not written down elsewhere.

**Gotchas that will bite again:**

- **`meta.target` is absent on a P2002 under the libsql adapter.** Measured 2026-09-05. The blocked column only appears at `meta.driverAdapterError.cause.constraint.fields`. Do not read which column collided off the error — use the error to learn *that* something collided, then look the blocker up by each value you tried to write.
- **`Prisma` is a runtime value**, exported at line 42 of `generated/pipeline/client.ts`, so `error instanceof Prisma.PrismaClientKnownRequestError` compiles and works.
- **`companyMatchKey` strips whitespace**, so `"  Acme  "` and `"Acme"` produce one key. That is why storing an untrimmed name never caused a duplicate row — the lookup goes by key, never by name.
- **Run every new test file against a deliberately wrong stub and read which tests pass.** Nine of task 7's tests passed against a step that did nothing, because they only asserted that nothing happened. The second-pass test now counts lookups; the empty-name test now runs a real name beside the empty one and counts creates.
- **The commit hook's "untested" list is wrong for a function reached through a factory's returned object.** It reported `createCompanyService`, `findBySlug`, `fakeCompanyService` and `labelCompany` as untested while every one of them had coverage. It only counts a function a test calls by name.
- **`cat` is blocked on any file over 2048 bytes** by a hook, and a bare `sleep` is blocked too. Use `Read`, or `sed -n 'A,Bp'` for a known span.
- Carried and still true: **`lib/settings-service.test.ts:283` will fail at task 8** — its `a company carries its name alongside its slug` test reads a name off the seeded `hinge-health` company, and the new seed stops writing one. **`lib/steps/search-orchestrator.test.ts:673` reads its own source file off disk.** **Blanking a comment block in `schema.prisma` fails the comment tests for the wrong reason.** **TypeScript will not narrow a trace writer from a saved boolean**, so the three-part `!== undefined` check stays inline. **`modified_at` has no database default**, so a raw SQL insert into `Company` must supply it. **`title_normalized` means a head noun matched, not that the text changed.** **A salary envelope carrying only a period is thrown out whole.** **The backlog lives at `docs/BACKLOG.md`.**

**Open threads:**

- **Whether `AtsCompany.name` exists at all is still task 8's call.** Nothing reads it: it appears only in `lib/settings-service.ts` where it is declared and `lib/collectors/ats-boards.ts` which passes it through, and the three ATS collectors read `ats_slug` alone.
- **The fake hands back the live object from its array, not a copy.** Change a returned record and you change the fake's state. A real database hands back a snapshot. Nothing does that today, and copying on every read is more machinery than a fake earns.
- **The `no_name_for_lookup` warning names an empty slug** where a job carries neither a slug nor a usable name. Collection's usability check drops such a job before association sees it, so the path is unreachable today.
- Carried: **backlog Future Ideas item 7, "Reorganize `lib/` folder structure", overlaps what phase 3a did**, and whether to trim it is unanswered. **`normalizeJobs` skips a job carrying no `id` or no `collector`** silently. **`level`, `role` and `team` are computed and thrown away.** **Criteria 93 and 96 wait on Phase 8.** **The two search issues live only on this branch** until cutover at phase 12. **The four silent source assumptions in the phase 1 r&d are still unguarded**, and phase 2's AC 15 printing half still has no standing test.

## Next Steps

1. **Commit the two modified doc files** before starting anything — the decision log and the phase 4 spec.

2. **Build task 8, the seed.** `scripts/db-seed.ts` — create with a slug and no name, look a company up by slug alone, warn on a clash. It currently creates companies directly through Prisma at line 140; route it through `createCompanyService(db)` instead. `create` returning `created: false` is the signal to warn. This is where the `AtsCompany.name` question gets answered.

3. **Task 9 is the seed's tests**, `scripts/db-seed.test.ts`, and `lib/settings-service.test.ts:283` has to change with them.

4. **Then tasks 10 to 13 in order**, as listed in `docs/CURRENT-FEATURE.md`.

5. **Every task is test-first.** Write the tests, run them against a deliberately wrong stub, read which ones pass, strengthen any that a do-nothing implementation satisfies — then dispatch `crowd-code`'s two writers. The spec's older tasks say "and its test" on some lines and not others; that is a cleanup artifact and means nothing.

6. **Anything new under `lib/steps/` loads the step contract** in `.claude/rules/pipeline-steps.md`.
