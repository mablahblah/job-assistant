---
paths: ["lib/**/*.ts", "scripts/**/*.ts"]
---

# Naming

## Folders

Every file in `lib/` sits in the folder named for the kind of thing it is. `lib/` itself holds no `.ts` file of its own. The kind a file belongs to is decided by what it does, not by who calls it.

| Folder               | Holds                                                           |
| -------------------- | --------------------------------------------------------------- |
| `lib/collectors/`    | The code that pulls a raw job list from one source              |
| `lib/db/`            | The database connection, its environment, the schema check, and the settings row's starting values |
| `lib/handlers/`      | The code that runs at one pipeline position                     |
| `lib/orchestrators/` | The runner that calls every handler in order                    |
| `lib/parsers/`       | The code that reads one source's job posting                    |
| `lib/resolvers/`     | The code that follows a job link toward its source posting      |
| `lib/services/`      | The code that owns one table or one row                         |
| `lib/tools/`         | Wrappers around something outside the app, and their interfaces |
| `lib/types/`         | Shapes shared across folders, holding no logic                  |
| `lib/utils/`         | Plain functions taking values and returning values              |
| `lib/views/`         | The code that turns data into a screen                          |

Only `lib/db/` builds the app's database connection. A test may open its own connection to a throwaway database it created.

## Files

Kebab-case (lowercase words joined by hyphens), named for the subject: `company-match-key.ts`, `job-dates.ts`.

A test sits beside the code it covers:

- `{name}.test.ts` tests one file.
- `{name}-events.test.ts` holds a handler's trace-row tests, the records of what happened to each job.
- `{scenario}.flow.test.ts` runs a whole job search or command from start to finish. It is named for the scenario it proves and sits beside the runner it drives.
- `{name}.fake.test.ts` tests a stand-in.

A stand-in used by more than one test file is `{name}.fake.ts`, named for the code it stands in for. A stand-in only one test file uses may stay inside that test file.

## Shapes

A shape used by more than one folder lives in `lib/types/`. A shape one folder uses stays in that folder. Test files do not count as a second folder.

The contract for a kind of file stays with that kind, whoever else reads it — `lib/collectors/collector.ts`, `lib/parsers/parser.ts`.

## Values

- A value that is the same every time the file loads, at the top of the file or the top of a `describe` block (a test group): SCREAMING_SNAKE (capital words joined by underscores) — `ACTIVE_STATUSES`. That covers a value written out in the file, and one built only from written-out pieces, such as `new Date("2026-09-01")` or `24 * HOUR_MS`.
- An object carrying functions, however it is built: camelCase (words joined, each after the first capitalised) — `adzunaCollector`
- A type or interface: PascalCase (words joined, every one capitalised) — `JobListEntry`
- Everything else, including a value that depends on where or when it runs, or that changes during a test: camelCase — `repoRoot`
