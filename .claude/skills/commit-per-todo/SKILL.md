---
name: commit-per-todo
description: When working through a todo list, commit after each item is completed rather than batching all changes into one commit at the end.
user-invocable: false
---

When executing a list of todos:

1. Complete one todo item
2. Mark it as done in the todo list
3. Immediately run `/commit` before moving to the next item
4. Only proceed to the next todo after the commit is confirmed

This keeps the git history granular and makes it easy to identify exactly what change introduced a problem.
