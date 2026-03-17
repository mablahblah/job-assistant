Read CLAUDE.md to understand the current project state and roadmap.

Then ask the user which feature they want to work on (suggest the top item from "Up Next" if they don't specify).

Once confirmed:

1. Begin with a planning session with user to define exactly the scope of this feature
2. Ask clarifying questions, but make no changes
3. Outline what you're going to build (a few bullets, no essay)
4. Create a new git branch named `feature/<slugified-feature-name>` and switch to it
5. Start building it

After the feature is working and tested, remind the user to run `/ship-feature`.
