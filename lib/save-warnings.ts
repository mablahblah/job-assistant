// Turns warnings from the save pipeline step into printable warning lines.
//
// This deliberately does not fold, unlike its sibling
// normalization-warnings.ts. That helper collapses ~1,800 jobs' worth of
// repeated field problems down to a count per collector, because one broken
// collector would otherwise bury every other warning. Here each warning is
// already a fact about specific database rows — a delete the active guard
// refused, or a job whose write threw and never landed. The user has to open
// those exact rows to fix them, and a count would only hide which rows they
// are. So one warning in, one line out, in the order they arrived.
import type { CollectionIssue } from "./collection-issue";
import type { JobListEntry } from "./job-list-entry";
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
    };

// A job's readable name is its title, falling back to the raw title where
// normalization left none. Either can arrive as an empty string rather than
// absent, and an empty string is no use as a label, so the fallback runs on
// emptiness and not only on absence; both are trimmed, since a source's
// stray whitespace would otherwise show up in the printed line. The id
// always tags along, because two jobs can show the same title. An entry with
// no id at all reaches here only through a failed write — the job service
// throws on one, and that throw is what the warning reports.
function labelJob(job: JobListEntry): string {
  const label = job.title?.trim() || job.raw_title?.trim() || "unlabeled job";
  return `${label} (id: ${job.id ?? "unknown"})`;
}

export function saveWarnings(warnings: SaveWarning[]): CollectionIssue[] {
  return warnings.map((warning) => {
    switch (warning.kind) {
      case "delete_refused":
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
      default: {
        // Exhaustiveness check: if a new SaveWarning kind is added without
        // a case above, this line fails to compile.
        const exhaustive: never = warning;
        return exhaustive;
      }
    }
  });
}
