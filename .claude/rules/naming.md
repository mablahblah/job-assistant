---
paths: ["lib/**/*.ts", "scripts/**/*.ts"]
---

# Naming

## Files

Kebab-case, named for the subject: `company-match-key.ts`, `job-dates.ts`.

A test sits beside the code it covers as `{name}.test.ts`. A handler's trace-row tests are a second file, `{name}-events.test.ts`.

A fake is `{name}.fake.ts`, and its test is `{name}.fake.test.ts`.

## Services

A service owns one table or one row and is built from the database client.

- File: `{subject}-service.ts`
- Type: `{Subject}Service`
- Builder: `create{Subject}Service(db)`
- Fake: `fake{Subject}Service()` in `{subject}-service.fake.ts`
- A row it reads back: `{Subject}Record`

## Orchestrators

An orchestrator calls every handler in order and hands down what they share.

- File: `lib/orchestrators/{subject}.ts`, named for what it runs — `job-search.ts`
- Function: `run{Subject}` — `runJobSearch`
- Options and result: `{Function}Options` and `{Function}Result`

## Handlers

- File: `lib/handlers/{subject}.ts`, named for what the handler does to a job list
- Function: a verb and a plural noun — `normalizeJobs`, `saveJobs`
- Options and result: `{Function}Options` and `{Function}Result`
- Parameters: `jobs`, then an options object. Collection takes options only, having no list to be handed.

A service handed to a handler arrives under a plain noun naming what it is for: `companies`, `settings`, `trace`. Where that noun is already the handler's first parameter, the field is `{subject}Service`.

## Tools

A tool wraps something outside the app behind a narrow interface. It owns no table and takes no job list.

- File: `lib/tools/{subject}.ts`
- Builder: `create{Subject}()` — `createResolutionBrowser()`
- The interface it satisfies is declared where its consumer needs it, not in its own file
- Fake: `fake{Subject}()` in `{subject}.fake.ts`

## Utils

A util takes values, returns values, and reaches no database.

- Converting: `{a}From{b}` or `{a}To{b}` — `messageFromThrown`, `descriptionToText`
- Answering yes or no: `is{X}` or `matches{X}` — `isActiveStatus`, `matchesSearchTerms`
- Every util names its subject.

## Values

- A module-level constant holding plain data: SCREAMING_SNAKE — `ACTIVE_STATUSES`, `WRITE_ONCE_FIELDS`
- A module-level object carrying functions: camelCase — `adzunaCollector`
- Everything else: camelCase
