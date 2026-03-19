Read CLAUDE.md and ROADMAP.md to understand the current project state and roadmap.

Read all SKILLS.md files, these should be used when relevant

Then ask the user which feature they want to work on (suggest the top item from "Up Next" if they don't specify).

Once confirmed:

1. Plan together with the user — do NOT enter plan mode or write a plan document:

- Ask the user what they envision — let them lead
- Ask one focused question at a time; don't front-load all decisions
- Only raise tradeoffs or alternatives when the user's answer creates a genuine fork in the road
- If a decision has downstream consequences (e.g. affects another screen or state), flag it briefly before moving on
- Keep the conversation tight — stop planning as soon as you have enough to start building

2. Ensure we're on a clean main before branching:

- `git checkout main && git pull`

3. Create a new git branch named `feature/<slugified-feature-name>`, switch to it, set it up on remote:

- `git checkout -b feature/<name>`
- `git push -u origin feature/<name>`

4. **Stop and explicitly tell the user:** "Please switch to Opus before we start building — use the model switcher in the top right." Do not proceed until they confirm.
5. Start building it

After the feature is working and tested, remind the user to run `/ship-feature`.
