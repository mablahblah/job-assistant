---
name: generate-resume
description: Generate a tailored, ATS-parsable PDF resume for a specific job posting. Looks the job up in the job-assistant database, reads the live posting, matches existing resume inventory items against its requirements, and renders a named PDF. Selection is pick-only — no resume text is written or edited, only which items are shown.
disable-model-invocation: true
arguments:
  - name: company
    description: Company to look up in the job-assistant database
  - name: role
    description: Optional role title, used to narrow the lookup when a company has several open jobs
argument-hint: "{company} [role]"
allowed-tools:
  - Bash(npx tsx scripts/cli.ts:*)
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
- ASK the user before deviating from any step.

## Reference

- **Portfolio project root:** `~/Documents/Projects/code/mablahblah_com`
- **Job-assistant project root:** `~/Documents/Projects/code/job-assistant`
- **Integration contract:** `scripts/job-assistant-contract.md` in the portfolio root. Read it when a command fails, an error string is unfamiliar, or the selections format needs confirming.

## Phase 1: Find the Job

1. Run from the job-assistant project root, omitting `{role}` when the user gave none:

   ```bash
   npx tsx scripts/cli.ts find-job {company} {role}
   ```

2. Parse the JSON array:
   - If the command exits non-zero or the array is empty: tell the user no matching jobs were found and stop.
   - If exactly one job matches: use it.
   - If several match: present a numbered list of company, title, status, and location, and ask the user to pick one.
3. Note the chosen job's `url`, `id`, `company`, and `title`. Later phases use all four.

## Phase 2: Fetch the Posting

1. Run from the job-assistant project root:

   ```bash
   npx tsx scripts/cli.ts fetch-page {url}
   ```

2. Judge the result.

### If the posting loads:

3a. Carry the HTML into Phase 3.

### If the posting is dead (404, empty body, error page, or wording such as "this posting has been removed"):

3b. Tell the user the posting at `{url}` appears dead, and ask them to check whether it is still live.
4b. If the user says it is live: retry the `fetch-page` command and return to step 2.
5b. If the user confirms it is dead: ask whether to mark the job expired. When they agree, run from the job-assistant project root, then stop:

    ```bash
    npx tsx scripts/cli.ts status <<'EOF'
    [{"jobId":"{id}","status":"expired"}]
    EOF
    ```

### If the posting loads but the content cannot be read:

3c. Ask the user to paste the page contents into the conversation, and continue with what they paste.

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

   In order: **Title** (pick 1), **Summary** (pick 1), **Skills** (max `{constraints.skills}`), **Tools** (max `{constraints.tools}`), then **Bullets — {company} ({role})** for each job whose `bullets.items` is non-empty, including jobs where nothing was chosen.

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
     "company": "{company}"
   }
   ```

   `bullets` carries a key for every job whose `bullets.items` is non-empty, even when the value is an empty array. Jobs with no configurable bullets are omitted entirely. `company` is the name from the Phase 1 lookup, not the shortened filename form.

3. Render, from the portfolio project root:

   ```bash
   node scripts/generate-pdf.js --selections /tmp/resume-selections.json --output ~/Documents/Projects/code/job-assistant/resumes/{filename}
   ```

   The script builds the app when needed, serves it, prints in headless Chromium, and shuts down. Never start a server yourself. The first run after a portfolio change is slower.

4. On failure the script writes `ERROR:` lines to stderr and exits 1, generating nothing. Read every error, correct the selections file, and return to step 3.
5. On success, delete `/tmp/resume-selections.json` and report: "Resume saved to `resumes/{filename}`".
