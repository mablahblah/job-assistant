The current feature is complete. Do the following:

1. Remind the user to do a quick manual smoke test if they haven't already. Ask for confirmation before continuing.
2. Read CLAUDE.md
3. Move the completed feature from its current section to the "Done" section
4. Update roadmap: Based on recent changes, are there new items that should be added to roadmap? removed? re-ordered? Ask for confirmation on changes.
5. Promote the next logical item into "Up Next" if the queue is empty
6. Write the updated CLAUDE.md
7. Stage all changes, commit with a summary message, and push:
   - `git add -A`
   - Commit message: "Ship: <feature name>" with Co-Authored-By trailer
   - `git push -u origin <current-branch>`
8. Create a PR to main using `gh pr create` with a brief title and bullet-point summary
9. Merge the PR using `gh pr merge --squash --delete-branch`
10. Switch back to main and pull: `git checkout main && git pull`
11. Update the roadmap: Are thereNeed to have a /ship-feature addition where it takes a look at the roadmap and suggests changes, re-organization, removing items, additions

Then run `/obsidian-sync` to keep the Obsidian vault in sync.
