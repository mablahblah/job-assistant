# Job Search Assistant — Agent Instructions

A personal CLI job search pipeline in TypeScript, run through Claude Code skills. It collects, resolves, parses, dedupes and classifies jobs into one SQLite database, and files the Texas unemployment work log on hand-made status changes. [CLAUDE.md](CLAUDE.md) is the project's main instruction file; this file points into it rather than repeating it.

## Build and Run

No build step: every command runs TypeScript through `tsx`. The full command list, with what each does, is in [CLAUDE.md](CLAUDE.md#commands).

```bash
npm install                      # postinstall runs `npx prisma generate`
npm run lint                     # ESLint, then `tsc --noEmit`
npm run test                     # Vitest, whole suite
npx prisma generate              # after any edit to prisma/schema.prisma
```

These reach the real database or outside services. Run them only when asked: `npm run job-search`, `score:gather`, `score:save`, `find-jobs`, `change-status`, `add-external-jobs`, `recover-unparseable-jobs`, `fetch-rendered-page`, `serve`, and every `db:*` command.

## Testing

```bash
npm run test                                  # all tests, time zone fixed to UTC
npx vitest run lib/utils/title.test.ts        # one file
npx vitest run -t "{test name}"               # one test by name
npm run test:watch                            # watch mode
```

Tests sit beside the code they cover. File naming (`.test.ts`, `-events.test.ts`, `.flow.test.ts`, `.fake.ts`) is set by [.claude/rules/naming.md](.claude/rules/naming.md). No test reaches a real job site, browser, paid service or `pipeline.db`: services and tools have `.fake.ts` stand-ins, and script tests build a throwaway database. The approach is described in [wiki/deep-dive/quality/testing.md](wiki/deep-dive/quality/testing.md).

## Project Structure

```
lib/        All app code, one folder per kind of part (see lib/AGENTS.md)
scripts/    One entry point per npm command (see scripts/AGENTS.md)
prisma/     schema.prisma and migrations
public/     Dashboard CSS and browser script
.claude/    Project skills and the rules in .claude/rules/
docs/       architecture.md, APP.md, DECISIONS.md, changelogs
wiki/       VitePress documentation site (see wiki/AGENTS.md)
```

Read [docs/architecture.md](docs/architecture.md) before changing code. The `lib/` folder map is in [.claude/rules/naming.md](.claude/rules/naming.md).

## Code Style

Conventions live in `.claude/rules/`, one file per kind of part. Each rule's `paths` frontmatter says which files it governs. The index of rules is the table at the end of [CLAUDE.md](CLAUDE.md#architecture). Start with:

- [.claude/rules/part-ownership.md](.claude/rules/part-ownership.md): where new behaviour goes, and what each part may never do
- [.claude/rules/naming.md](.claude/rules/naming.md): file, folder, test and value names

The working agreements in [CLAUDE.md](CLAUDE.md#working-agreements) apply to every change. ESLint config is [.eslintrc.json](.eslintrc.json); TypeScript is strict ([tsconfig.json](tsconfig.json)).

## Git Workflow

- Work happens on `feature/{name}` branches merged to `main` by pull request.
- Commit messages are one plain-English sentence in the imperative, with no type prefix: `Search a link first, then the employer, in find-jobs`.
- Run `npm run lint` and `npm run test` before committing.

## Boundaries

- ✅ **Always do:** follow the rule in `.claude/rules/` for the folder you edit. Put a test beside new code. Run lint and tests before committing. Run `npx prisma generate` after editing the schema.
- ⚠️ **Ask first:** running any command that reaches the database, a browser or a paid API. Changing `prisma/schema.prisma`. Adding a dependency. Adding or renaming a collector or parser (see [.claude/rules/source-registry.md](.claude/rules/source-registry.md)). Running `change-status`, which files a legal work log entry.
- 🚫 **Never do:** change the schema any way other than `npm run db:migrate`. Point `db:create` at the real database. Commit or quote `.env`, any `*.db` file, or the gitignored personal folders and docs listed in [.gitignore](.gitignore). Write site-specific knowledge into code outside collectors and parsers.

## Documentation

- Wiki: [wiki/](wiki/index.md), architecture, pipeline steps, onboarding guides
- LLM context: [llms.txt](llms.txt) (summary), [wiki/llms-full.txt](wiki/llms-full.txt) (every page inlined)
