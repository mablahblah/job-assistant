---
name: generate-resume
description: Generate a tailored, ATS-parsable PDF resume for a specific job posting - /generate-resume [company] [role]
---

# Generate Resume

Generate a tailored PDF resume for a job posting. The job description drives all content selections — no resume text is edited, only which items are shown.

- `/generate-resume Acme senior product designer`
- `/generate-resume Omada`

## Reference

- **Portfolio project root:** `~/Documents/Projects/code/mablahblah_com`
- **Job-assistant project root:** `~/Documents/Projects/code/job-assistant`
- **Integration contract:** `docs/features/export-parsable-pdf-resume/integration-contract.md` (read this if you need full details on selection rules or validation)

## Instructions

### Step 1: Look up the job

Run from the job-assistant project root:

```bash
npx tsx scripts/cli.ts find-job {company} {role}
```

`{company}` is required. `{role}` is optional — use it if the user provided one.

Parse the JSON array output:

- **No matches** (non-zero exit, error on stderr): tell the user no matching jobs were found and stop.
- **One match**: proceed with that job.
- **Multiple matches**: present a numbered list showing each job's company, title, status, and location. Ask the user to pick one.

Note the selected job's `url` (for Step 2), `id` (for potential status update), and `company` + `title` (for Step 5).

### Step 2: Fetch the job posting

Run from the job-assistant project root:

```bash
npx tsx scripts/cli.ts fetch-page {url}
```

Use the `url` from the selected job.

**If the page loads successfully:** proceed to Step 3 with the HTML content.

**If the page appears dead** (404, empty content, error page, or the HTML clearly shows a "job not found" / "this posting has been removed" message):

1. Tell the user: "The posting at `{url}` appears to be dead. Can you check if it's still live?"
2. If the user says it's not dead: retry the `fetch-page` command.
3. If the user confirms it's dead: ask "Would you like me to mark this job as expired?" If yes, run:
   ```bash
   npx tsx scripts/cli.ts status <<'EOF'
   [{"jobId":"{jobId}","status":"expired"}]
   EOF
   ```
   Then stop.

**If the page is accessible but the content cannot be read or processed:** ask the user to copy the page contents and paste them into the conversation, then continue with the pasted content.

### Step 3: Get resume inventory

Run from the portfolio project root:

```bash
cd ~/Documents/Projects/code/mablahblah_com && node scripts/generate-pdf.js --inventory
```

Parse the JSON output. The key structures are:

- `titles.items` — title options (pick exactly 1 by `id`)
- `summaries.items` — summary options (pick exactly 1 by `id`)
- `skills.items` — skill options (pick 0 to `constraints.skills` by `id`)
- `tools.items` — tool options (pick 0 to `constraints.tools` by `id`)
- `experience[]` — each job entry; if `bullets.items.length > 0`, that job has configurable bullets
- `constraints.bullets` — max total bullets across ALL jobs combined

Each item has: `id` (used in selections), `text` (what appears on the resume), `default` (whether active by default).

### Step 4: Analyze and present selections

Analyze the job description from Step 2 against the inventory from Step 3. For each section, select the items that best match the job requirements.

Present the full inventory for each section using this format:

**Title** (pick 1):

```
✅  {text} | {rationale tied to the job description}
❌  {text}
```

**Summary** (pick 1):

```
✅  {text} | {rationale tied to the job description}
❌  {text}
```

**Skills** (max {constraints.skills}):

```
✅  {text} | {rationale tied to the job description}
❌  {text}
```

**Tools** (max {constraints.tools}):

```
✅  {text} | {rationale tied to the job description}
❌  {text}
```

**Bullets — {experience.company} ({experience.role})** (max {constraints.bullets} total across all jobs):

```
✅  {text} | {rationale tied to the job description}
❌  {text}
```

Repeat the bullets subsection for every job in the inventory where `bullets.items.length > 0`, even if no bullets were selected for that job.

Rules:

- Every item in each section is shown — selected and deselected
- ✅ items include a brief rationale tied to the job description
- ❌ items do not need a rationale
- Total bullets across all jobs must not exceed `constraints.bullets`

### Step 5: Propose filename

Propose a filename:

`Matt_Mannello-Resume-{Company}-{Shortened_Role}-{Year}.pdf`

- **Company**: shortened to the recognizable core name, underscores for spaces. Examples: "Acme International Dynamics, Inc" becomes "Acme", "Google LLC" becomes "Google".
- **Role**: shortened with common abbreviations, underscores for spaces. Examples: "Senior Product Designer" becomes "Sr_Prod_Designer", "Lead UX Designer" becomes "Lead_UX_Designer".
- **Year**: current year, 4 digits.

Present the proposed filename. The user can accept or adjust.

### Step 6: User approval

Present the selections and filename together, then ask:

"Here are my selections and proposed filename. Want me to proceed, or would you like to adjust anything?"

- **Approve**: proceed to Step 7.
- **Request changes**: adjust the selections or filename as requested, re-present the affected sections, and ask again.
- **Cancel**: stop without generating.

### Step 7: Generate PDF

1. Create the output directory if it doesn't exist:

```bash
mkdir -p ~/Documents/Projects/code/job-assistant/resumes
```

2. Build the selections JSON from the approved selections. The required format:

```json
{
  "title": "{selected-title-id}",
  "summary": "{selected-summary-id}",
  "bullets": {
    "{job-id}": ["{bullet-id-1}", "{bullet-id-2}"],
    "{job-id-2}": []
  },
  "skills": ["{skill-id-1}", "{skill-id-2}"],
  "tools": ["{tool-id-1}", "{tool-id-2}"],
  "company": "{company-name-from-db}"
}
```

The `bullets` object must include a key for every job where `bullets.items.length > 0` in the inventory — even if the value is an empty array. Jobs where `bullets.items` is empty must NOT appear. The `company` field is the company name from the DB lookup in Step 1.

3. Write the selections JSON to a temp file (use epoch seconds for the timestamp):

```bash
cat > /tmp/resume-selections-$(date +%s).json <<'EOF'
{the selections JSON}
EOF
```

Note the exact path used (including the timestamp) for the next command.

4. Generate the PDF from the portfolio project root:

```bash
cd ~/Documents/Projects/code/mablahblah_com && node scripts/generate-pdf.js --selections {selections-file-path} --output ~/Documents/Projects/code/job-assistant/resumes/{approved-filename}
```

5. If the command exits with `ERROR:` lines on stderr: read each error message, fix the selections JSON to address all errors, write the corrected file to the same path, and retry step 4.

6. On success, delete the temp file:

```bash
rm {selections-file-path}
```

7. Report: "Resume saved to `resumes/{approved-filename}`"
