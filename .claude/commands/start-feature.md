Read CLAUDE.md and ROADMAP.md to understand the current project state and roadmap.

Read all SKILLS.md files, these should be used when relevant

Then ask the user which feature they want to work on (suggest the top item from "Up Next" if they don't specify).

Once confirmed:

- Star planning mode...
  - Agree on initial scope of feature
  - Discuss and align on UX flow, walk through the experience step by step to ensure alignment
    - Ask user first to describe what they invision, poke holes in it if possible
    - At each decision point, present the options with a plain-language explanation of the tradeoff, then ask which direction they want to go
  - If a decision has downstream consequences (e.g. affects another screen or state), flag it before moving on. If it alters roadmap, suggest edits to roadmap now.
  - Summarize work succinctly and ask user to confirm before continuiing
- Ensure we're on a clean main before branching:
  - `git checkout main && git pull`
- Create a new git branch named `feature/<slugified-feature-name>`, switch to it, set it up on remote:
  - `git checkout -b feature/<name>`
  - `git push -u origin feature/<name>`
- Start building it

After the feature is working and tested, remind the user to run `/ship-feature`.
