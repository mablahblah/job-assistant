// Searches for each employer on a list and saves the contact details a Texas
// Workforce Commission filing asks for — an address, a phone number and a
// website.
//
// It runs after every status and every work log entry has been written. The
// searches are the slow part and the part a time limit can cut short, so a run
// stopped early loses searches and never loses a filing.
//
// The service is paid per search, so an employer already filled in is never
// asked about again, and an employer holding no name is never asked about at
// all — a query built from a blank name matches every result and would hand
// back a stranger's address.
//
// No trace rows. A status change made by hand is not a job passing through a
// pipeline step.

import type { CompanyService } from "../services/company-service";
import type { CompanySearch } from "../tools/company-search";
import { MissingSearchCredentialError } from "../tools/company-search";
import { queryFromCompany } from "../utils/enrichment-query";
import { matchesCompanyName } from "../utils/enrichment-name-match";
import { contactFromText, type ContactDetails } from "../utils/enrichment-contact";
import { doubtsFromContact, type EnrichmentDoubt } from "../utils/enrichment-doubts";
import { messageFromThrown } from "../utils/thrown-message";

export interface EnrichmentTarget {
  company_id: string;
  // The place the job's location matched, where the job carrying this
  // employer had one.
  place?: string | null;
}

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

export interface EnrichCompaniesOptions {
  companies: CompanyService;
  search: CompanySearch;
  now: Date;
}

export interface EnrichCompaniesResult {
  companies: EnrichedCompany[];
  warnings: string[];
}

interface Searched {
  result: EnrichedCompany;
  warning?: string;
}

// The employer is read fresh from the service on every target rather than
// cached. That is what makes one employer standing behind two jobs in the
// same run cost one search: the first pass fills it in, and the second sees
// that and stops.
async function searchForOne(
  target: EnrichmentTarget,
  options: EnrichCompaniesOptions
): Promise<Searched> {
  const { companies, search, now } = options;

  const company = await companies.findById(target.company_id);
  if (company === null) {
    return {
      result: {
        company_id: target.company_id,
        company_name: null,
        outcome: "failed",
        doubts: [],
      },
      warning: `No employer holds the id ${target.company_id}`,
    };
  }

  if (company.enriched_at !== null) {
    return {
      result: {
        company_id: company.id,
        company_name: company.name,
        outcome: "already_filled",
        doubts: [],
      },
    };
  }

  if (company.name === null || company.name.trim() === "") {
    return {
      result: {
        company_id: company.id,
        company_name: company.name,
        outcome: "no_name",
        doubts: [],
      },
    };
  }

  // Held in a local so the rest of this function reads a name the compiler
  // knows is there, rather than casting one back each time.
  const companyName = company.name;

  try {
    // Goes down before the search starts, so a run cut short partway is told
    // apart from one never tried.
    await companies.startEnrichment(company.id);

    const query = queryFromCompany(companyName, target.place);

    let results: { title: string; text: string }[];
    try {
      results = await search.search(query);
    } catch (thrown) {
      // Nothing here closes the employer to a later search. A missing
      // credential, a service error, no results and results naming nobody
      // all leave it open; only a search that filled a field in closes it,
      // and the company service is what decides that.
      if (thrown instanceof MissingSearchCredentialError) {
        return {
          result: {
            company_id: company.id,
            company_name: companyName,
            outcome: "no_credential",
            doubts: [],
          },
          warning: `No search credential, so no search was made for ${companyName}`,
        };
      }
      return {
        result: {
          company_id: company.id,
          company_name: companyName,
          outcome: "failed",
          doubts: [],
        },
        warning: `The search for ${companyName} failed: ${messageFromThrown(thrown)}`,
      };
    }

    // The name is matched first and values are read only out of the result
    // that matched. The old code scanned every result for a value while
    // checking the name on the first result alone, with nothing connecting
    // the two — measured against the live service, that would have taken an
    // unrelated university's address off a government-contracts listing.
    const match = results.find((result) => matchesCompanyName(companyName, result.title));
    const found: ContactDetails = match ? contactFromText(match.text) : {};

    const doubts = doubtsFromContact(found);
    await companies.saveEnrichment(company.id, found, doubts, now);

    const filled = Boolean(found.address || found.phone || found.website);
    return {
      result: {
        company_id: company.id,
        company_name: companyName,
        outcome: filled ? "filled" : "found_nothing",
        doubts,
      },
    };
  } catch (thrown) {
    return {
      result: {
        company_id: company.id,
        company_name: companyName,
        outcome: "failed",
        doubts: [],
      },
      warning: `The search for ${companyName} failed: ${messageFromThrown(thrown)}`,
    };
  }
}

export async function enrichCompanies(
  targets: EnrichmentTarget[],
  options: EnrichCompaniesOptions
): Promise<EnrichCompaniesResult> {
  const searched: EnrichedCompany[] = [];
  const warnings: string[] = [];

  // Every failure is caught per employer, so one bad search never costs the
  // rest. The old code threw its search away and swallowed every error it
  // raised; waiting for the search means those errors come back into the loop.
  for (const target of targets) {
    const { result, warning } = await searchForOne(target, options);
    searched.push(result);
    if (warning !== undefined) warnings.push(warning);
  }

  return { companies: searched, warnings };
}
