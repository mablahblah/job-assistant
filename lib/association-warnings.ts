// Turns warnings from the company association pipeline step into printable
// warning lines.
//
// This deliberately does not fold, unlike its sibling
// normalization-warnings.ts. That helper collapses ~1,800 jobs' worth of
// repeated field problems down to a count per collector, because one broken
// collector would otherwise bury every other warning. Here each warning is
// already a fact about two specific database rows (a job with no company, or
// two companies clashing over one name) — the user has to open those exact
// rows to fix them, and a count would only hide which rows they are. So one
// warning in, one line out, in the order they arrived.
import type { CollectionIssue } from "./collection-issue";
import type { CompanyRecord } from "./company-service";

export type AssociationWarning =
  | { kind: "no_name_for_lookup"; collector: string; slug: string }
  | {
      kind: "company_name_clash";
      collector: string;
      name: string;
      target: CompanyRecord;
      heldBy: CompanyRecord;
    };

// A company always carries a name, a board slug, or both. Where it has a
// name, that's the readable label; where it has none, the slug stands in for
// it, since being nameless is an ordinary state and not a fault. The id
// always tags along, because two companies can otherwise show the same label.
function labelCompany(company: CompanyRecord): string {
  const label = company.name ?? company.ats_slug ?? "unlabeled company";
  return `${label} (id: ${company.id})`;
}

export function associationWarnings(warnings: AssociationWarning[]): CollectionIssue[] {
  return warnings.map((warning) => {
    switch (warning.kind) {
      case "no_name_for_lookup":
        // The job travels the rest of the pipeline without a company. Save
        // is a later phase, so nothing has been written when this is raised.
        return {
          collector: warning.collector,
          message: `Job from board slug "${warning.slug}" matched no company and carried no employer name, so it goes on without one.`,
        };
      case "company_name_clash":
        return {
          collector: warning.collector,
          message: `Could not write the name "${warning.name}" to ${labelCompany(warning.target)} because ${labelCompany(warning.heldBy)} already holds that name. Merge these two company rows by hand.`,
        };
      default: {
        // Exhaustiveness check: if a new AssociationWarning kind is added
        // without a case above, this line fails to compile.
        const exhaustive: never = warning;
        return exhaustive;
      }
    }
  });
}
