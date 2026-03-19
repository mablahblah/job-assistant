Read CLAUDE.md and ROADMAP.md to understand the current project state and roadmap.

Read all SKILLS.md files, these should be used when relevant

Then ask the user which feature they want to work on (suggest the top item from "Up Next" if they don't specify).

Once confirmed:

- Then start a planning session with user to define exactly the scope of this feature
- Ask clarifying questions, but make no changes
- Outline what you're going to build (a few bullets, no essay)
- Ensure we're on a clean main before branching:
  - `git checkout main && git pull`
- Create a new git branch named `feature/<slugified-feature-name>`, switch to it, set it up on remote:
  - `git checkout -b feature/<name>`
  - `git push -u origin feature/<name>`
- Start building it

After the feature is working and tested, remind the user to run `/ship-feature`.
