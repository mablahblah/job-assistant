---
name: add-parser
description: Builds a new ATS parser end-to-end — discovers the source's data access pattern, creates parser and tests, registers in the pipeline, and verifies against live data. Adapts to new parser patterns rather than forcing existing ones.
arguments:
  - name: ats_name
    description: The name of the ATS platform to build a parser for (e.g., Workable, SmartRecruiters)
argument-hint: "Workable"
---

# Add Parser

## Phase 1: Discover

1. Research {ats_name} — check for public API docs, inspect a sample job page (HTML structure, JSON-LD, embedded app data like `window.__appData`), and note what data is available.
2. Map available data to `ParsedFields`: title, companyName, location, workMode, postedAt, salaryRange. Note which fields are available and which are missing.
3. Determine the access pattern:
   - API with structured responses → API parser
   - HTML with embedded script data → HTML fetch parser
   - No independent source page (aggregator) → pass-through parser
   - Something else → document the new pattern before building

### If a new pattern is identified:

4a. Discuss the new pattern with the user — what makes it different, what abstractions (if any) it needs.
5a. Build the parser for the new pattern.
6a. Update `.claude/rules/pipeline.md` to document the new pattern.

### If an existing pattern fits:

4b. Reference the closest existing parser as a structural guide — adapt, don't copy.

## Phase 2: Build

5. Create `lib/parsers/{ats_name}.ts` implementing `ParserFn`.
6. Create `lib/parsers/{ats_name}.test.ts` with fixture-based tests.
7. Register via `registerParser(domain, fn)` in `lib/pipeline.ts`.
7b. Add the parser to the priority list in `lib/dedupe.ts` — slot it by result quality (lower number = higher fidelity). See existing entries for reference.
8. If pass-through: add source gate in `pipeline.ts`.

## Phase 3: Verify

9. Run the parser against live job URLs and spot-check every field: title, companyName, location, workMode, postedAt, salaryRange.
10. If a new pattern was established in Phase 1: confirm the pipeline rule update is accurate.
