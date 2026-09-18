// What one employer's contact search came to. The handler that runs the
// search and the report that prints it both read this shape, so it lives here
// rather than in either of them — a plain function may not reach up into a
// handler for it.
//
// An outcome says why a search did or did not fill anything in. The service
// is paid per search, so "already filled" and "no name" are outcomes in their
// own right rather than failures: both mean no search was made.
import type { EnrichmentDoubt } from "../utils/enrichment-doubts";

export type EnrichOutcome =
  | "filled"
  | "already_filled"
  | "no_name"
  | "found_nothing"
  | "no_credential"
  | "failed";

export interface EnrichedCompany {
  company_id: string;
  company_name: string | null;
  outcome: EnrichOutcome;
  doubts: EnrichmentDoubt[];
}
