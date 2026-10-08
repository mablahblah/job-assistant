---
name: generate-resume
description: Generate a tailored, ATS-parsable PDF resume for a specific job posting. Looks the job up in the job-assistant database by its link or its employer, reads the live posting, matches existing resume inventory items against its requirements, and renders a named PDF. Selection is pick-only — no resume text is written or edited, only which items are shown.
disable-model-invocation: true
arguments:
  - name: job
    description: The job's link, or its employer's name
  - name: role
    description: Optional role words, used to pick one job when the employer has several
argument-hint: "{link or company} [role]"
allowed-tools:
  - Bash(npm run find-jobs:*)
  - Bash(npm run fetch-rendered-page:*)
  - Bash(node scripts/generate-pdf.js:*)
  - Bash(mkdir:*)
  - Bash(rm:*)
  - Read
  - Write
---

# Generate Resume

# Execution Policy

- Do NOT write, reword, or invent resume text. Selection is pick-only from the inventory.
- Do NOT generate a PDF before the user has approved both the selections and the filename.
- Do NOT abbreviate the selections display. Every item in every section is shown, chosen and rejected alike.
- Do NOT pass the role words to the job lookup. The lookup finds the employer's jobs, and you pick the one the role words describe.
- ASK the user before deviating from any step.

## Reference

- **Portfolio project root:** `~/Documents/Projects/code/mablahblah_com`
- **Job-assistant project root:** `~/Documents/Projects/code/job-assistant`
- **Integration contract:** `scripts/job-assistant-contract.md` in the portfolio root. Read it when a command fails, an error string is unfamiliar, or the selections format needs confirming.

## Phase 1: Find the Job

1. Sort `{job}`, `{role}` and anything else the user said about the job into three parts: a link (text starting `http`), an employer name, and role words. Any part may be missing.
   - If there is neither a link nor an employer name: ask the user for one, and continue with their answer.
2. Run from the job-assistant project root. Pass `--url` only when there is a link, and `--company` only when there is an employer name:

   ```bash
   npm run find-jobs -- --url "{link}" --company "{employer}"
   ```

3. Read the JSON object the command prints. `jobs` holds the matches. `found_by` says which search found them: `link` or `employer`. `link_problem` says what went wrong with the link: `no_match`, `not_a_link`, or `null`.
   - If the command exits non-zero: report its error to the user and stop.
   - If `link_problem` is `no_match`: tell the user no saved job holds that link.
   - If `link_problem` is `not_a_link`: tell the user the text given as a link is not a web address.
4. Choose the job from `jobs`. A list shown to the user is numbered and shows each job's `company_name`, `title`, `status`, and `location`.

### If `jobs` is empty:

5a. Tell the user no job matched, and ask for other words or a different link.
6a. Return to step 1 with their answer.

### If `found_by` is `link`:

5b. If exactly one job came back: use it.
6b. If several came back: list them and ask the user to pick one.

### If `found_by` is `employer`:

5c. Keep the jobs whose title is the role words shortened, reordered, or abbreviated. "sr pd" fits "Senior Product Designer".
6c. If exactly one job fits, or no role words were given and the employer has one job: use it without asking.
7c. Otherwise, list the fitting jobs when several fit, or every job when none fits or no role words were given, and ask the user to pick one.

8. Note the chosen job's `id`, `company_name`, `title`, `original_url` (the address the job was collected with), and `resolved_url` (the source posting's own address). Later phases use them all.

## Phase 2: Fetch the Posting

1. Choose the link to fetch: `resolved_url` where it is not null, `original_url` otherwise.
2. Run from the job-assistant project root:

   ```bash
   npm run fetch-rendered-page -- --url "{url}"
   ```

   The command opens the page in a browser, waits for its scripts to finish, and prints the finished HTML.

3. Judge the result.

### If the command fails (non-zero exit, an error message instead of HTML):

This is a tool failure — a fact about the fetch, not about the job. Never treat it as a dead posting.

4a. Report the tool failure to the user, quoting the command's error text.
5a. Ask whether to retry the fetch or to paste the page contents instead, and continue with whichever they choose.

### If the posting loads:

4b. Carry the HTML into Phase 3.

### If the posting loads but reads as dead (404, empty body, error page, or wording such as "this posting has been removed"):

4c. Tell the user the posting at `{url}` appears dead, and ask them to check whether it is still live.
5c. If the user says it is live: retry the fetch command and return to step 3.
6c. If the user confirms it is dead: tell them a resume cannot be written from a dead posting, leave the job's status untouched, and stop.

### If the posting loads but the content cannot be read:

4d. Ask the user to paste the page contents into the conversation, and continue with what they paste.

## Phase 3: Read the Resume Inventory

1. Run from the portfolio project root:

   ```bash
   node scripts/generate-pdf.js --inventory
   ```

2. Parse the JSON. It holds:
   - `titles.items` — pick exactly 1 by `id`
   - `summaries.items` — pick exactly 1 by `id`
   - `skills.items` — pick 0 to `constraints.skills` by `id`
   - `tools.items` — pick 0 to `constraints.tools` by `id`
   - `experience[]` — one entry per job; a job has configurable bullets when `bullets.items` is non-empty
   - `constraints.bullets` — the maximum total bullets across every job combined

   Each item carries `id` for selections, `text` for what prints, and `default` for its resting state.

## Phase 4: Match Content to the Posting

1. Read the posting from Phase 2 against the inventory from Phase 3, and choose the items that answer what the posting asks for.
2. Present every section in this shape, listing all items — chosen and rejected:

   ```
   ✅  {text} | {why this posting wants it}
   ❌  {text}
   ```

   In order: **Title** (pick 1), **Summary** (pick 1), **Skills** (max `{constraints.skills}`), **Tools** (max `{constraints.tools}`), then **Bullets — {prev-company} ({prev-role})** for each job whose `bullets.items` is non-empty, including jobs where nothing was chosen.

3. Confirm the chosen bullets total no more than `constraints.bullets` across all jobs. Reduce the weakest matches until they do.

## Phase 5: Get Approval

1. Propose a filename: `Matt_Mannello-Resume-{Company}-{Shortened_Role}-{Year}.pdf`
   - **Company** — the recognisable core name, underscores for spaces. "Acme International Dynamics, Inc" gives `Acme`.
   - **Shortened_Role** — common abbreviations, underscores for spaces. "Senior Product Designer" gives `Sr_Prod_Designer`.
   - **Year** — the current year, four digits.
2. Present the selections and the filename together, then ask whether to proceed or adjust.
   - If approved: continue to Phase 6.
   - If changes are requested: revise, re-present the affected sections, and ask again.
   - If cancelled: stop without generating.

## Phase 6: Generate the PDF

1. Create the output directory:

   ```bash
   mkdir -p ~/Documents/Projects/code/job-assistant/resumes
   ```

2. Write the approved selections to `/tmp/resume-selections.json`:

   ```json
   {
     "title": "{title-id}",
     "summary": "{summary-id}",
     "bullets": { "{job-id}": ["{bullet-id}"], "{job-id-2}": [] },
     "skills": ["{skill-id}"],
     "tools": ["{tool-id}"],
     "company": "{company_name}"
   }
   ```

   `bullets` carries a key for every job whose `bullets.items` is non-empty, even when the value is an empty array. Jobs with no configurable bullets are omitted entirely. `company` is the `company_name` from the Phase 1 lookup, not the shortened filename form.

3. Render, from the portfolio project root:

   ```bash
   node scripts/generate-pdf.js --selections /tmp/resume-selections.json --output ~/Documents/Projects/code/job-assistant/resumes/{filename}
   ```

   The script builds the app when needed, serves it, prints in headless Chromium, and shuts down. Never start a server yourself. The first run after a portfolio change is slower.

4. On failure the script writes `ERROR:` lines to stderr and exits 1, generating nothing. Read every error, correct the selections file, and return to step 3.
5. On success, delete `/tmp/resume-selections.json` and report: "Resume saved to `resumes/{filename}`".
6. Also provide user with the exact portfolio url used in the resume.
