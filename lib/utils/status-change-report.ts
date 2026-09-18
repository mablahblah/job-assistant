// The lines a status-change run prints. This phase builds no page, so these
// are the only place the user learns that a Texas Workforce Commission record
// exists, or that one they expected does not.
//
// It cannot use the shared run-summary helper. That helper reads its counts
// back from trace rows, and this flow writes none, so the report is built from
// what the handlers returned.
//
// The lines are read by a skill as well as by the user. It has to tell "this
// job needs an employer name" from "no job holds that id" in order to know
// whether to ask for a name, so those two wordings are fixed values rather
// than labels anyone may reword.
import type { ChangedJob } from "../types/changed-job";
import type { EnrichedCompany } from "../types/enriched-company";

export interface StatusChangeReportInput {
  changes: ChangedJob[];
  companies: EnrichedCompany[];
}

// Every case either says an entry was written or says one was not. The
// reasons differ but the skill only reads the two states, so the failure and
// skip cases are worded apart for the user and alike for the reader.
function jobLine(change: ChangedJob): string {
  const { job_id, status, outcome, entry_written } = change;
  switch (outcome) {
    case "no_such_job":
      return `  ${job_id}: no job holds that id — not changed.`;
    case "needs_company_name":
      return `  ${job_id}: needs an employer name — not changed.`;
    case "changed":
      return entry_written
        ? `  ${job_id}: status changed to "${status}" — work log entry written.`
        : `  ${job_id}: status changed to "${status}" — no work log entry.`;
    case "no_title":
      return `  ${job_id}: no title to file the entry under — no work log entry.`;
    case "entry_failed":
      return `  ${job_id}: status changed to "${status}", but the filing failed — no work log entry.`;
    default: {
      // An outcome added to the handler without a line here fails the build
      // rather than quietly going unreported.
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}

// A doubt is named so the user checks that detail before filing rather than
// after. The words are the handler's own, printed as they stand.
function employerLine(company: EnrichedCompany): string {
  const name = company.company_name ?? company.company_id;
  let line: string;

  switch (company.outcome) {
    case "filled":
      line = `  ${name}: contact details filled in.`;
      break;
    case "already_filled":
      line = `  ${name}: already filled in — left as it stands.`;
      break;
    case "found_nothing":
      line = `  ${name}: the search ran and found nothing.`;
      break;
    case "no_credential":
      line = `  ${name}: no credential on file, so no search was made.`;
      break;
    case "no_name":
      line = `  ${name}: holds no name to search with.`;
      break;
    case "failed":
      line = `  ${name}: the search failed.`;
      break;
    default: {
      const unhandled: never = company.outcome;
      line = unhandled;
    }
  }

  if (company.doubts.length > 0) {
    const label = company.doubts.length > 1 ? "Doubts" : "Doubt";
    line += ` ${label}: ${company.doubts.join(", ")}.`;
  }

  return line;
}

export function statusChangeReport(input: StatusChangeReportInput): string[] {
  const { changes, companies } = input;
  const lines: string[] = [];

  if (changes.length === 0) {
    lines.push("No job was named for a status change.");
  } else {
    lines.push("Status changes:");
    for (const change of changes) {
      lines.push(jobLine(change));
    }
  }

  // No heading where nothing was searched. A heading with nothing under it
  // reads as "every search came back empty" rather than "nobody needed one".
  if (companies.length > 0) {
    lines.push("Employers searched:");
    for (const company of companies) {
      lines.push(employerLine(company));
    }
  }

  return lines;
}
