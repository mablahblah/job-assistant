The current feature is complete. Do the following:

1. Prompt user to switch to sonnet for this
1. Remind the user to do a quick manual smoke test if they haven't already. Ask for confirmation before continuing.
1. Read CLAUDE.md and ROADMAP.md
1. Move the completed feature from ROADMAP.md to ROADMAP-DONE.md (append at bottom, chronological order)
1. Update ROADMAP.md: Based on recent changes, are there new items that should be added? removed? re-ordered? Ask for confirmation on changes.
1. Promote the next logical item into "Up Next" if the queue is empty
1. Update CLAUDE.md with any key architectural decisions or things that will maintain consistency going forward, no need to document everything, use judgement and ask if uncertain
1. Stage all changes, commit with a summary message, and push:
   - `git add -A`
   - Commit message: "Ship: <feature name>" with Co-Authored-By trailer
   - `git push -u origin <current-branch>`
1. Create a PR to main using `gh pr create --base main` with a brief title and bullet-point summary
1. Merge the PR and delete the remote branch: `gh pr merge --squash --delete-branch`
1. Switch back to main, pull, and delete the local branch:
   - `git checkout main && git pull`
   - `git branch -d feature/<name>`
1. Verify git is clean: `git branch -a` should show only `main` locally and `origin/main` remotely

Then run `/obsidian-sync` to keep the Obsidian vault in sync.
