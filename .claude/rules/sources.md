---
paths: ["lib/collectors/**/*.ts", "lib/parsers/**/*.ts"]
---

# Collectors and Parsers

## Collectors

A collector pulls a raw job list from exactly one source.

- File: `lib/collectors/{subject}.ts`, named for the source it pulls from — `adzuna.ts`
- Value: `{subject}Collector` — `export const adzunaCollector: Collector`
- Its `name` field matches its filename — `name: "adzuna"` in `adzuna.ts`
- It joins the pipeline by being listed in `lib/collectors/registry.ts`

## Parsers

A parser returns only the fields it found on the posting.

- File: `lib/parsers/{subject}.ts`, named for the source it reads — `greenhouse.ts`
- Value: `{subject}Parser` — `export const greenhouseParser: Parser`
- Its `name` field matches its filename — `name: "greenhouse"` in `greenhouse.ts`
- It joins the pipeline by being listed in `lib/parsers/registry.ts`, keyed by the website its source owns. The one exception is `general.ts`, the general parser. It owns no website, and the registry hands it any web link no other parser claims.
