---
name: change-status
description: Changes the status of one or more jobs. Finds each job by its link or its employer, writes the new status, and files a Texas Workforce Commission work log entry where the status calls for one. Use when a job has moved — applied, rejected, screening, interview, test, offer.
disable-model-invocation: true
arguments:
  - name: request
    description: One or more jobs, each named by its link or by its employer and roughly its role, with the status it moves to
argument-hint: "indeed sr pd -> rejected, apple -> rejected"
---

# Change Status

# Execution Policy

- Do NOT change a status without running the lookup first.
- Do NOT ask which job when exactly one matched.
- Do NOT pass a role to the lookup. The user writes shorthand no stored title contains.
- Do NOT widen a search on your own. Ask first.
- Do NOT name a job in a second run that the first run did not ask about.
- ASK the user before deviating from any step.

## Phase 1: Read the request

1. Split `{request}` into one item per job. Each item names a link (text starting `http`) or an employer, sometimes a role, and one new status.
2. Match each item's status to one of the twelve the database accepts:

   `backlog`, `expired`, `too far`, `won't apply`, `unresolvable`, `unparseable`, `rejected`, `app. sent`, `screening`, `interview`, `test`, `offer`

   - If a status matches none of the twelve: tell the user which one, and stop.

## Phase 2: Find each job

1. Pick which statuses to search, from the status being set:

   | Status being set | Statuses to search |
   | --- | --- |
   | `app. sent`, `too far`, `won't apply`, `expired`, `unresolvable`, `unparseable` | `backlog` |
   | `screening`, `interview`, `test`, `offer`, `rejected` | `app. sent,screening,interview,test,offer` |
   | `backlog` | every status — leave the flag off |

2. Run the lookup for each item. Pass `--url` only when the item has a link, and `--company` only when it names an employer:

```bash
npm run find-jobs -- --url "{link}" --company "{employer}" --statuses "{statuses to search}"
```

3. Read the JSON object the lookup prints. `jobs` holds the matches. `link_problem` says what went wrong with the link: `no_match`, `not_a_link`, or `null`.
   - If `link_problem` is `no_match`: tell the user no job in the searched statuses holds that link.
   - If `link_problem` is `not_a_link`: tell the user the text given as a link is not a web address.
4. Compare the jobs to the role the request named:
   - If exactly one job came back, or one clearly fits the role: use its id.
   - If more than one still fits: show them and ask the user which.
   - If `jobs` is empty: tell the user, and ask whether to search every status. Run again without `--statuses` only if they say yes.

## Phase 3: Change the statuses

1. Write a scratch JSON file outside the project folder, `{submission}`, holding one entry per job found:

```json
[{ "job_id": "...", "status": "..." }]
```

2. Run the change:

```bash
npm run change-status -- --in {submission}
```

## Phase 4: Finish the jobs the run held back

1. Read each report line. A line holding `needs an employer name` means that job carries no employer on file, and its status was not changed.
   - Ask the user for the employer name of each such job.
   - Write a second scratch file, `{answers}`, naming only the jobs the run asked about, each carrying its answer:

   ```json
   [{ "job_id": "...", "status": "...", "company_name": "..." }]
   ```

   - Run `npm run change-status -- --in {answers}`.
2. A line holding `no job holds that id` is a different fault. Report it to the user and do not ask for an employer name.
3. Show the user the report lines, including which jobs had a Texas Workforce Commission work log entry written.
