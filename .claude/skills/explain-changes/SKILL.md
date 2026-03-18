---
name: explain-changes
description: Always explain what a code change does and why we're making it, in plain language, before or alongside the change. Also applies to bash command approval prompts.
user-invocable: false
---

Whenever making a code change or requesting user approval for a bash command:

- **What**: Describe what the change does in plain language (not just what the code says, but what it means)
- **Why**: Explain why we're making it — what problem it solves, what it enables, or what decision it reflects

This applies to:
- File edits and new files
- Bash commands that require user approval (e.g. "Allow npm install X" — explain what the package does and why we need it)
- Schema or config changes
- Any non-obvious refactor or restructure

Keep explanations concise — one or two sentences is enough. The goal is understanding, not documentation.
