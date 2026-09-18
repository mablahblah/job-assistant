// Turns warnings from the save pipeline step into printable warning lines.
//
// This deliberately does not fold, unlike its sibling
// normalization-warnings.ts. That helper collapses ~1,800 jobs' worth of
// repeated field problems down to a count per collector, because one broken
// collector would otherwise bury every other warning. Here each warning is
// already a fact about specific database rows — a delete the active guardrail
// refused, or a job whose write threw and never arrived. The user has to open
// those exact rows to fix them, and a count would only hide which rows they
// are. So one warning in, one line out, in the order they arrived.
import type { CollectionIssue } from "../types/collection-issue";
import type { JobListEntry } from "../types/job-list-entry";
import { labelJob } from "./job-label";
import { messageFromThrown } from "./thrown-message";

export type SaveWarning =
  | {
      kind: "delete_refused";
      collector: string;
      // The duplicate dedupe marked for deletion.
      entry: JobListEntry;
      // The active row that refused to go, handed back by the job service.
      blockedBy: JobListEntry;
    }
  | {
      kind: "db_write_failed";
      collector: string;
      // The job that never became a row.
      entry: JobListEntry;
      thrown: unknown;
    }
  | {
      kind: "company_write_failed";
      collector: string;
      // The employer's id alone. An employer met only as a board holds no
      // name, so the id is the one thing every one of them can be opened by.
      companyId: string;
      thrown: unknown;
    };

export function saveWarnings(warnings: SaveWarning[]): CollectionIssue[] {
  return warnings.map((warning) => {
    switch (warning.kind) {
      case "delete_refused":
        // Two steps mark an entry for deletion and the same guardrail refuses
        // both, so the reason the entry was marked is the only thing telling
        // them apart. Resolution's mark sits on the job's own row rather than
        // a duplicate's, so entry and blockedBy are one row here and the
        // duplicate wording would name it twice and blame a match that never
        // happened. blockedBy is the one named, because the status the user
        // acted on is the stored row's.
        if (warning.entry.delete_on_save === "blacklisted_url") {
          return {
            collector: warning.collector,
            message: `Delete refused: ${labelJob(warning.blockedBy)} was marked for removal because its resolution reached a blacklisted site, but the row is already at status "${warning.blockedBy.status}". The row was kept — delete it by hand if you do not want it.`,
          };
        }

        // Both rows are named so the user can open each one. There is no
        // automatic path for this pair: the duplicate is either caught by a
        // later run or left standing. blockedBy always carries an active
        // status, since that is the only thing that refuses a delete.
        return {
          collector: warning.collector,
          message: `Delete refused: ${labelJob(warning.entry)} duplicates ${labelJob(warning.blockedBy)}, which is already at status "${warning.blockedBy.status}". Both rows were kept — reconcile them by hand.`,
        };
      case "db_write_failed":
        return {
          collector: warning.collector,
          message: `Database write failed for ${labelJob(warning.entry)}, so the job was not saved: ${messageFromThrown(warning.thrown)}`,
        };
      case "company_write_failed":
        return {
          collector: warning.collector,
          message: `Company ${warning.companyId} could not be saved: ${messageFromThrown(warning.thrown)}`,
        };
      default: {
        // Exhaustiveness check: if a new SaveWarning kind is added without
        // a case above, this line fails to compile.
        const exhaustive: never = warning;
        return exhaustive;
      }
    }
  });
}
