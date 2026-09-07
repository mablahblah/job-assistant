---
paths: ["lib/**/*.ts", "scripts/**/*.ts"]
---

# Naming

## Files

Kebab-case, named for the subject: `company-match-key.ts`, `job-dates.ts`.

A test sits beside the code it covers as `{name}.test.ts`. A step's trace-row tests are a second file, `{name}-events.test.ts`.

A fake is `{name}.fake.ts`, and its test is `{name}.fake.test.ts`.

## Services

A service owns one table or one row and is built from the database client.

- File: `{subject}-service.ts`
- Type: `{Subject}Service`
- Builder: `create{Subject}Service(db)`
- Fake: `fake{Subject}Service()` in `{subject}-service.fake.ts`
- A row it reads back: `{Subject}Record`

## Steps

- File: `lib/steps/{step}.ts`, named for the step's word in the `Trace.step` vocabulary
- Function: a verb and a plural noun — `normalizeJobs`, `saveJobs`
- Options and result: `{Function}Options` and `{Function}Result`
- First parameter: `jobs`

A service handed to a step arrives under a plain noun naming what it is for: `companies`, `settings`, `trace`. Where that noun is already the step's first parameter, the field is `{subject}Service`.

## Utils

A util takes values, returns values, and reaches no database.

- Converting: `{a}From{b}` or `{a}To{b}` — `messageFromThrown`, `descriptionToText`
- Answering yes or no: `is{X}` or `matches{X}` — `isActiveStatus`, `matchesSearchTerms`
- Every util names its subject.

## Values

- A module-level constant holding plain data: SCREAMING_SNAKE — `ACTIVE_STATUSES`, `WRITE_ONCE_FIELDS`
- A module-level object carrying functions: camelCase — `adzunaCollector`
- Everything else: camelCase
