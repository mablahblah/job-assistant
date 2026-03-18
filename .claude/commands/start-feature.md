Read CLAUDE.md and ROADMAP.md to understand the current project state and roadmap.

Then ask the user which feature they want to work on (suggest the top item from "Up Next" if they don't specify).

Once confirmed:

1. Begin with a planning session with user to define exactly the scope of this feature
2. Ask clarifying questions, but make no changes
3. Outline what you're going to build (a few bullets, no essay)
4. Ensure we're on a clean main before branching:
   - `git checkout main && git pull`
5. Create a new git branch named `feature/<slugified-feature-name>`, switch to it, set it up on remote:
   - `git checkout -b feature/<name>`
   - `git push -u origin feature/<name>`
6. Start building it

After the feature is working and tested, remind the user to run `/ship-feature`.
