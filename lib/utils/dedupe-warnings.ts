// Turns warnings from the dedupe pipeline step into printable warning lines.
//
// This deliberately does not fold, unlike its sibling
// normalization-warnings.ts. That helper collapses ~1,800 jobs' worth of
// repeated field problems down to a count per collector, because one broken
// collector would otherwise bury every other warning. Here each warning is
// already a fact about a specific job — a database lookup that threw and left
// its entry uncompared. The user has to open that exact entry to fix it, and a
// count would only hide which entry it is. So one warning in, one line out, in
// the order they arrived.
import type { CollectionIssue } from "../types/collection-issue";
import type { JobListEntry } from "../types/job-list-entry";
import { labelJob } from "./job-label";
import { messageFromThrown } from "./thrown-message";

export type DedupeWarning = {
  kind: "lookup_failed";
  collector: string;
  // The entry whose database lookup threw. It stays on the list unchanged,
  // because under-merging is the cheaper failure — it saves as its own row
  // and a later pass collapses it.
  entry: JobListEntry;
  thrown: unknown;
};

export function dedupeWarnings(warnings: DedupeWarning[]): CollectionIssue[] {
  return warnings.map((warning) => {
    switch (warning.kind) {
      case "lookup_failed":
        return {
          collector: warning.collector,
          message: `Database lookup failed for ${labelJob(warning.entry)}, so it was kept on the list unchanged: ${messageFromThrown(warning.thrown)}`,
        };
      default: {
        // Exhaustiveness check: if a new DedupeWarning kind is added without
        // a case above, this line fails to compile. It reads the kind rather
        // than the warning, because dedupe raises one kind today and a lone
        // member narrows away only through its discriminator.
        const exhaustive: never = warning.kind;
        return exhaustive;
      }
    }
  });
}
