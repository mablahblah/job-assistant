The current feature is complete. Do the following:

1. Remind the user to do a quick manual smoke test if they haven't already
2. Read CLAUDE.md
3. Move the completed feature from its current section to the "Done" section
4. Promote the next logical item into "Up Next" if the queue is empty
5. Write the updated CLAUDE.md
6. Stage all changes, commit with a summary message, and push:
   - `git add -A`
   - Commit message: "Ship: <feature name>" with Co-Authored-By trailer
   - `git push -u origin <current-branch>`
7. Create a PR to main using `gh pr create` with a brief title and bullet-point summary
8. Merge the PR using `gh pr merge --squash --delete-branch`
9. Switch back to main and pull: `git checkout main && git pull`

Then run `/obsidian-sync` to keep the Obsidian vault in sync.
