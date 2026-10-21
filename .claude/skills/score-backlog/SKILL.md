---
name: score-backlog
description: Scores every backlog job against the job alignment rubric and researches every employer behind those jobs against the company rubric, then saves both. Use when the user asks to score the backlog, score jobs, or score companies, and when a job search has just finished.
---

# Score Backlog

# Execution Policy

- Do NOT run any collector, resolver, parser or classifier. This skill judges what is already in the database.
- Do NOT run the `serve` skill. The caller decides whether to start the viewing server.
- Do NOT score a company yourself. Every company goes to a helper of its own.
- Do NOT check a job posting against a blocked-website list. A posting the pipeline already resolved is one to read.
- Do NOT set a company aside for being a job board rather than the employer. Score it like any other company.
- ASK the user before deviating from any step.

## Phase 1: Gather what needs scoring

1. Pick a scratch file path for this run, `{work_file}`, outside the project folder.
2. Run the gather command:

```bash
npm run score:gather -- --out {work_file}
```

   - If you hold a run identifier for this scoring — read from a job search's `Run:` line, or handed over by the user: add `--run-id {run_id}` so this scoring joins that run's records.

3. Read `{work_file}`. It holds:
   - `runId` — the identifier every record this run writes will carry
   - `jobs` — every backlog job with no alignment score
   - `companies` — every employer behind one of those jobs that is missing a score
   - `warnings` — anything the user needs to know
   - `failure` — where the gather stopped, or `null`, meaning it did not stop

4. Check what the gather found:
   - If `failure` is not `null`: report where it stopped and why, then STOP.
   - If both lists are empty: report "Nothing to score" and STOP.

## Phase 2: Score every company

1. Read `company-rubric.md` in this skill's directory.
2. Send one helper per company. One company is one helper, because scoring a company means live web research.
3. Give each helper the company's `name`, the rubric, and the list of categories that company is missing — the ones left empty (`null`) on its record.

**Company scoring helper** task prompt:

> Research the employer {company_name} and score it on each of these categories: {missing_categories}.
>
> The rubric:
>
> {company_rubric}
>
> Return one JSON object and nothing else:
>
> `{"id": "{company_id}", "scores": {"{category}": {"score": 1-5, "rationale": "2-3 sentences", "guessed": true or false}}}`
>
> Set `guessed` to true where you found nothing public and awarded a 3 by the rubric's own rule.
>
> If the company has no name to research, return `{"id": "{company_id}", "failure": "no_company_name"}` instead.

4. Collect every helper's answer.

## Phase 3: Score every job

1. Read `job-rubric.md` and `.alignment-info.md` in this skill's directory. The first holds the scoring rules. The second holds the candidate's profile.
2. Split the jobs into two groups:
   - Jobs carrying `description` — the posting's own words.
   - Jobs carrying no `description`.
3. Send jobs carrying the posting's words to helpers **10 at a time**.
4. Send each job carrying no posting words to a helper of its own, because that helper has to open the posting and read it first.

**Job alignment helper** task prompt:

> Score each of these jobs for how well it fits the candidate, using the rubric below.
>
> The candidate:
>
> {candidate_profile}
>
> The rubric:
>
> {job_alignment_rubric}
>
> The jobs:
>
> {jobs}
>
> Where a job carries no `description`, open the page at its `resolved_url` and read the posting before scoring it.
>
> Return one JSON array and nothing else, one object per job:
>
> `{"id": "{job_id}", "alignment_score": 1-5, "alignment_rationale": "2-3 sentences"}`
>
> Where a job carries no `description` and no `resolved_url`, return `{"id": "{job_id}", "failure": "no_posting_url"}`.
> Where the page at `resolved_url` will not open, return `{"id": "{job_id}", "failure": "posting_unreadable"}`.

5. Collect every helper's answer.

## Phase 4: Save the scores

1. Write an answer file, `{answer_file}`, shaped:

```json
{
  "runId": "{run_id_from_the_work_file}",
  "jobs": [],
  "companies": []
}
```

2. Save each batch as it comes back, rather than holding every score until the end. A run that stops halfway keeps the research it already paid for.

```bash
npm run score:save -- --in {answer_file}
```

3. On the last batch, ask for the summary as well:

```bash
npm run score:save -- --in {answer_file} --summary
```

4. Report to the user, in this order:
   - Every warning, as written.
   - If the output says `Run stopped at ...`: report that line, then STOP.
   - The summary, pasted into your reply inside a fenced code block, a box that shows text exactly as printed. Do not reword it, reorder it, shorten it, or swap it for a count of your own. The user never sees the command's output, so your paste is the only copy they get.

## Notes

- The save command ends with an error status when the save stopped early. Check that status rather than guessing from the printed text.
- A helper that comes back with nothing is recorded as a failure and the run carries on. Leave that job or company out of the answer file, or give it no score — either way the save records it.
