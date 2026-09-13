---
paths: ["lib/**/*.ts", "scripts/**/*.ts"]
---

# Naming

## Folders

Every file in `lib/` sits in the folder named for the kind of thing it is. `lib/` itself holds no `.ts` file of its own. The kind a file belongs to is decided by what it does, not by who happens to call it.

| Folder               | Holds                                                             |
| -------------------- | ----------------------------------------------------------------- |
| `lib/collectors/`    | The code that pulls a raw job list from one source                 |
| `lib/db/`            | The database connection, its environment, and the schema check     |
| `lib/handlers/`      | The code that runs at one pipeline position                        |
| `lib/orchestrators/` | The runner that calls every handler in order                       |
| `lib/parsers/`       | The code that reads one source's job posting                       |
| `lib/resolvers/`     | The code that follows a job link toward its source posting         |
| `lib/services/`      | The code that owns one table or one row                            |
| `lib/tools/`         | Wrappers around something outside the app, and their interfaces    |
| `lib/types/`         | Shapes shared across folders, holding no logic                     |
| `lib/utils/`         | Plain functions taking values and returning values                 |

## Files

Kebab-case, named for the subject: `company-match-key.ts`, `job-dates.ts`.

A test sits beside the code it covers as `{name}.test.ts`. A handler's trace-row tests are a second file, `{name}-events.test.ts`.

A fake is `{name}.fake.ts`, and its test is `{name}.fake.test.ts`.

## Types

A type file declares a shape. It holds no logic, reaches no database, and calls nothing.

- File: `lib/types/{subject}.ts`, named for the shape — `job-list-entry.ts`, `collection-issue.ts`
- A shape only one folder uses stays in that folder rather than moving here
- The contract for a kind is named for that kind and sits with it — `lib/collectors/collector.ts`, `lib/parsers/parser.ts`. It is not a type file, because it describes what a file must look like rather than what a value is.

## Services

A service owns one table or one row and is built from the database client.

- File: `lib/services/{subject}-service.ts`
- Type: `{Subject}Service`
- Builder: `create{Subject}Service(db)`
- Fake: `fake{Subject}Service()` in `lib/services/{subject}-service.fake.ts`
- A row it reads back: `{Subject}Record`

## Database

`lib/db/` holds the connection, the environment it reads, and the check that the schema matches the code. Nothing outside it builds a connection of its own.

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
- The interface it satisfies sits in `lib/tools/` beside it — `resolution-page.ts`
- Fake: `fake{Subject}()` in `lib/tools/{subject}.fake.ts`

## Collectors

A collector pulls a raw job list from one source. Like a parser it is the differentiated code a handler runs.

- File: `lib/collectors/{subject}.ts`, named for the source it pulls from — `adzuna.ts`, `dribbble.ts`
- Value: `{subject}Collector` — `export const adzunaCollector: Collector`
- Its `name` field matches its filename — `name: "adzuna"` in `adzuna.ts`
- It joins the pipeline by being listed in `lib/collectors/registry.ts`

## Parsers

A parser reads one source's job posting and returns the fields it found. Like a collector it is the differentiated code a handler runs.

- File: `lib/parsers/{subject}.ts`, named for the source it reads — `greenhouse.ts`, `dribbble.ts`
- Value: `{subject}Parser` — `export const greenhouseParser: Parser`
- Its `name` field matches its filename — `name: "greenhouse"` in `greenhouse.ts`
- It joins the pipeline by being listed in `lib/parsers/registry.ts`, keyed by the domain its source owns

## Resolvers

A resolver follows a job link toward the source posting, driving a page it was handed.

- File: `lib/resolvers/{subject}.ts`, named for what it does — `resolve-job-url.ts`
- Function: a verb and its subject — `resolveJobUrl`
- It takes a page, never builds one. The browser behind that page is a tool.

## Utils

A util takes values, returns values, and reaches no database.

- File: `lib/utils/{subject}.ts`
- Converting: `{a}From{b}` or `{a}To{b}` — `messageFromThrown`, `descriptionToText`
- Answering yes or no: `is{X}` or `matches{X}` — `isActiveStatus`, `matchesSearchTerms`
- Every util names its subject.
- A util used by one folder only still lives here. `ashby-fields.ts` is read by a collector and a parser, and would be miscast in either.

## Values

- A module-level constant holding plain data: SCREAMING_SNAKE — `ACTIVE_STATUSES`, `WRITE_ONCE_FIELDS`
- A module-level object carrying functions: camelCase — `adzunaCollector`
- Everything else: camelCase
