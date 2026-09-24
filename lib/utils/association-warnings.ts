// Turns warnings from the company association pipeline step into printable
// warning lines.
//
// This deliberately does not fold, unlike its sibling
// normalization-warnings.ts. That helper collapses ~1,800 jobs' worth of
// repeated field problems down to a count per collector, because one broken
// collector would otherwise bury every other warning. Here each warning is
// already a fact about two specific database rows (a job with no company,
// two companies clashing over one name, or a board name clashing between two
// hiring systems) — the user has to open those exact rows to fix them, and a
// count would only hide which rows they are. So one warning in, one line
// out, in the order they arrived.
import type { CollectionIssue } from "../types/collection-issue";
import type { CompanyRecord } from "../services/company-service";

export type AssociationWarning =
  | { kind: "no_company_name"; collector: string; slug: string }
  | {
      kind: "company_name_clash";
      collector: string;
      name: string;
      target: CompanyRecord;
      // The board slug the job carried, where it had one. A company met only
      // as a board holds no name, and its slugs live in a table this file is
      // not handed, so the slug travels with the warning instead.
      targetSlug?: string;
      heldBy: CompanyRecord;
    }
  // The lookup itself threw, so there is no pair of companies to describe —
  // only what went wrong. Kept apart from the one below because a job whose
  // lookup failed has no company at all, and one whose slug write failed has
  // its company and is missing only the record of the board it posts on.
  | { kind: "company_lookup_failed"; collector: string; message: string }
  | { kind: "board_slug_failed"; collector: string; message: string }
  // The board table records one hiring system per slug. A job read by a
  // second system carried a slug already recorded from a first, so company
  // matching attached it to whichever company that slug already belongs to —
  // possibly the wrong one.
  | {
      kind: "board_name_clash";
      collector: string;
      slug: string;
      recordedParser: string;
      arrivingParser: string;
    };

// A company's name is its readable label. Where it has none, the board slug
// the job arrived on stands in, since being nameless is an ordinary state and
// not a fault. The id always tags along, because two companies can otherwise
// show the same label.
function labelCompany(company: CompanyRecord, slug?: string): string {
  const label = company.name ?? slug ?? "unlabeled company";
  return `${label} (id: ${company.id})`;
}

export function associationWarnings(warnings: AssociationWarning[]): CollectionIssue[] {
  return warnings.map((warning) => {
    switch (warning.kind) {
      case "no_company_name":
        // The job travels the rest of the pipeline without a company. Save
        // is a later phase, so nothing has been written when this is raised.
        return {
          collector: warning.collector,
          message: `Job from board slug "${warning.slug}" matched no company and carried no employer name, so it goes on without one.`,
        };
      case "company_name_clash":
        return {
          collector: warning.collector,
          message: `Could not write the name "${warning.name}" to ${labelCompany(warning.target, warning.targetSlug)} because ${labelCompany(warning.heldBy)} already holds that name. Merge these two company rows by hand.`,
        };
      case "company_lookup_failed":
        return {
          collector: warning.collector,
          message: `Could not look up a company for this job, so it goes on without one: ${warning.message}`,
        };
      case "board_slug_failed":
        return {
          collector: warning.collector,
          message: `Found this job's company but could not record the board it posts on: ${warning.message}`,
        };
      case "board_name_clash":
        return {
          collector: warning.collector,
          message: `Board name "${warning.slug}" was already recorded from ${warning.recordedParser}, but a job read by ${warning.arrivingParser} carried the same name, so it was matched to the company that board belongs to. These may be two different companies — check that company by hand.`,
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
