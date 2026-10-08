---
name: add-external-jobs
description: Adds jobs found outside a job search from their links — reads each posting, runs only those jobs through the job search's steps, scores the backlog, and reports where each job landed. Use when the user pastes one or more job links to add.
disable-model-invocation: true
arguments:
  - name: links
    description: One or more links to job postings, pasted by the user
argument-hint: "https://boards.greenhouse.io/acme/jobs/123 https://jobs.lever.co/beta/456"
---

# Add External Jobs

# Execution Policy

- Do NOT start the add command when no link was given.
- Do NOT guess a title or employer for a page you could not read. Ask the user.
- Do NOT run `npm run job-search`, or any single step of the pipeline, alongside the add command.
- Do NOT run the scoring commands yourself. The `score-backlog` skill runs them.
- Do NOT score after a stopped run.
- Do NOT pass on a run summary, from the add command or from scoring.
- ASK the user before deviating from any step.

## Phase 1: Read Each Posting

1. If `{links}` holds no link: tell the user no link was given, and STOP.
2. Open each link in `{links}` and read its posting for three things:
   - **title** - the job title
   - **employer** - the company hiring
   - **description** - the posting's own words, as written
3. Set aside each link whose page will not open, or opens on something that is not the posting — a sign-in wall, a bot check, a list of jobs.
4. Ask the user for the title and employer of each link set aside, one link at a time.
   - If the user does not know them: keep the link with no title and no employer.

## Phase 2: Run the Add Command

1. Write `{submission_file}`, a scratch file outside the project folder. It holds one JSON list, one entry per link, in the order given:

```json
[{ "link": "{link}", "title": "{title}", "employer": "{employer}", "description": "{description}" }]
```

   Leave out any field you do not have. Keep a link that is not a web address; the command refuses it and names it in a warning.

2. Tell the user a browser window may open partway through and hold the screen while it follows links.
3. Run the add command:

```bash
npm run add-external-jobs -- --in {submission_file}
```

4. Read the output. It arrives in this order:
   - `Run: {run_id}` — always the first line. Note the identifier: scoring joins this run's records through it.
   - One line per link. A saved job reads `- {title} at {employer}: {status}`, with `(reason: {reason})` when it did not reach the backlog, and `— could not be judged for certain ({reasons})` when the run let it through. A link with no job reads `- {link}: not added ({reason})`.
   - `Warnings:` — either `none`, or one indented line per warning.
   - `Run stopped at {step}: {reason}` — present only when the run stopped. It names the step and the reason, then lists the steps that finished first.
   - `Trace failures: {n}` — present only when a diagnostic row failed to save. The run's work is unaffected.

### If the run stopped:

5a. The command ends with a failure code. Report every warning as written, the step it stopped at, its reason, and the steps that finished.
6a. Tell the user which links to add again: every link whose line is not at `backlog`, or that has no line.
7a. STOP.

### If the run finished:

5b. Continue to Phase 3.

## Phase 3: Score the Backlog

1. Invoke the `score-backlog` skill, handing it `{run_id}`, so its records land under this run.
2. Keep its warnings for the report. Leave out its summary block.
   - If it reports "Nothing to score" or stops: say so in the report, and continue to Phase 4.

## Phase 4: Report Where Each Job Landed

1. Report in this shape, and nothing else:

```
Added {job title} - {company}, {job title} - {company}

{n} of the jobs were added to the backlog and scored:
- {job title} - {company}
- {job title} - {company}: could not be judged for certain ({each reason as printed})

{n} of the jobs were not added:
- {job title} - {company}: {reason}

Warnings:
- {warning}
```

   - Name a job by its link where it has no title and no company.
   - If a not-added line gives no reason: give its status as the reason.
   - Under Warnings, list every warning the add command and scoring printed, or `none`.
