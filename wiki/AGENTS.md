# Wiki — Agent Instructions

A VitePress documentation site for the Job Search Assistant. Every page explains part of the code and cites the lines it describes. Project-wide instructions are in [../AGENTS.md](../AGENTS.md).

## Build and Run

Run these inside `wiki/`. The wiki has its own `package.json`, separate from the app's.

```bash
npm install            # VitePress, mermaid, vitepress-plugin-mermaid
npm run docs:dev       # local dev server
npm run docs:build     # production build; fails on a dead internal link
npm run docs:preview   # serve the last build
```

After a build, delete `.vitepress/dist` and `.vitepress/cache` unless you need them. Both are gitignored.

## Wiki Structure

- `index.md`: landing page with quick start, architecture diagram, documentation map
- `onboarding/`: contributor, staff engineer, executive and product manager guides
- `getting-started/`: overview, setup, commands and skills, quick reference
- `deep-dive/`: `architecture/`, `data/`, `pipeline/`, `agent-workflows/`, `dashboard/`, `quality/`
- `catalogue.json`: the page plan. The sidebar and nav in `.vitepress/config.mts` are built from it, so a new page goes in here too.
- `.vitepress/theme/`: dark theme (`custom.css`) and diagram zoom and colour fixes (`index.ts`)
- `llms.txt`: page index for language models; `llms-full.txt`: every page inlined. Regenerate both when pages change.

## Content Conventions

- **Frontmatter:** every page starts with `title` and `description`.
- **Citations:** `[path:line](https://github.com/mablahblah/job-assistant/blob/main/path#Lline)`, ranges as `#Lstart-Lend`. The path must be tracked by git and the lines must exist in the file.
- **Mermaid:** dark colours only. Node fill `#2d333b`, border `#6d5dfc`, text `#e6edf3`, subgraph `#161b22` with border `#30363d`, lines `#8b949e`. Use `<br>`, never `<br/>`. Every `sequenceDiagram` has `autonumber`. `classDef default` is not valid in `stateDiagram-v2`; use a named class there.
- **Diagram sources:** each diagram is followed by a `<!-- Sources: path:line, ... -->` comment.
- **Vue safety:** outside code, wrap generics like `Promise<Job[]>` and any `{{` in backticks.
- **Source of truth:** the code. `README.md` at the repo root is a short summary; cite the code, not the README.

## Boundaries

- ✅ **Always do:** run `npm run docs:build` after editing. Check new citations against the current file. Keep relative links between pages relative, with the `.md` extension.
- ⚠️ **Ask first:** changing `.vitepress/config.mts` or the theme. Restructuring sections or `catalogue.json`.
- 🚫 **Never do:** link to, quote or describe the contents of private paths: `.env`, `*.db`, `data/`, `resumes/`, `generated/`, `history/`, `prototypes/`, `docs/features/`, `docs/ideas/`, `docs/research/`, `docs/investigations/`, `docs/tech/`, `docs/BACKLOG.md`, `docs/CURRENT-FEATURE.md`, `docs/PRIORITIES.md`, `.claude/skills/score-backlog/.alignment-info.md`. The `.alignment-info.example.md` file is public. Never use light-mode diagram colours.

## Documentation

- LLM context: [llms.txt](llms.txt) (summary), [llms-full.txt](llms-full.txt) (full content)
- Onboarding: [onboarding/](onboarding/contributor-guide.md)
