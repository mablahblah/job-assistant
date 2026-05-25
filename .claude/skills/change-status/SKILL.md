---
name: change-status
description: Change a job's status
disable-model-invocation: true
---

# Change Status

Change a job's status. Accepts natural language like:

- `/change-status job 3 to 'app. sent'`
- `/change-status the Figma posting to screening`

## Instructions

1. Parse the user's request to identify:
   - **Which job** — by session number (assigned by `/view-backlog` or `/view-active-jobs`), job ID, or description (company + title)
   - **New status** — one of: `backlog`, `too far`, `won't apply`, `app. sent`, `rejected`, `screening`, `interview`, `test`, `offer`, `expired`

2. If the job reference is ambiguous (e.g., "the Stripe job" but there are multiple), ask for clarification.

3. If the user provides a session number (`#3`, `job 3`), look up the ID from the most recent `/view-backlog` or `/view-active-jobs` output in this conversation.

4. Run:

   ```bash
   npx tsx scripts/cli.ts status <<'EOF'
   [{"jobId":"<jobId>","status":"<newStatus>"}]
   EOF
   ```

5. Confirm the change: "Updated [Title] at [Company] → [status]"

6. If the status is a qualifying one (`app. sent`, `screening`, `interview`), note that a work search log entry was auto-created.
