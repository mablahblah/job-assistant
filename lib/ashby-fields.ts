// Maps an Ashby posting's own fields into the shape both a collector and a
// parser write to the database. It does the mapping only — building the
// posting's link and stamping the phase gates belongs to whichever one calls
// this, since a parser already holds a resolved link and is about to close
// its own gate, and this mapper touching either would let one overwrite the
// other's work.
//
// Ashby's API carries no employer name at all — verified live on 2026-09-12
// against the hinge-health board, whose answer holds only `jobs` and
// `apiVersion`. So a job records only the slug of the board it came from, and
// the parser reads the name off the board page's title instead.
import type { MappedJobFields, RawSalary } from "./job-list-entry";

export interface AshbySecondaryLocation {
  location?: string;
}

export interface AshbyCompensationComponent {
  compensationType: string;
  interval?: string | null;
  currencyCode?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
}

export interface AshbyPosting {
  title: string;
  isListed: boolean;
  jobUrl: string;
  publishedAt: string;
  location?: string;
  secondaryLocations?: AshbySecondaryLocation[];
  workplaceType?: string | null;
  descriptionPlain?: string;
  descriptionHtml?: string;
  compensation?: {
    summaryComponents?: AshbyCompensationComponent[];
  };
}

export interface AshbyJobBoardResponse {
  jobs: AshbyPosting[];
}

export function jobFieldsFromAshbyPosting(posting: AshbyPosting, slug: string): MappedJobFields {
  // The plain-text field wins over the HTML one when both are present, and a
  // blank one counts as none.
  const description = posting.descriptionPlain || posting.descriptionHtml || undefined;

  // The primary location first, then any secondary ones, all kept. Blanks are
  // dropped rather than stored as empty entries.
  const raw_location_list = [
    posting.location,
    ...(posting.secondaryLocations?.map((secondary) => secondary.location) ?? []),
  ].filter((location): location is string => Boolean(location));

  // Stored exactly as Ashby sends it — Remote, Hybrid, or OnSite. Mapping
  // those words onto the three the app uses is normalization's job, and a
  // posting without the field leaves the list empty for a parser to fill.
  // The isRemote flag is deliberately not read: it is true on hybrid postings
  // anchored to an office, so it contradicts workplaceType.
  const raw_mode_list = posting.workplaceType ? [posting.workplaceType] : [];

  // summaryComponents mixes salary, equity, commission, and bonus entries in
  // no fixed order — equity is frequently first, carrying null values — so the
  // salary is picked out by type rather than taken as the first entry. The
  // interval and the currency are recorded as sent, because a source's own
  // words about its own pay are what the raw fields are for. No salary_unit,
  // since Ashby sends whole currency units rather than cents.
  const salaryComponent = posting.compensation?.summaryComponents?.find(
    (component) => component.compensationType === "Salary"
  );
  const raw_salary: RawSalary | undefined = salaryComponent
    ? {
        salary_min: salaryComponent.minValue ?? undefined,
        salary_max: salaryComponent.maxValue ?? undefined,
        salary_period: salaryComponent.interval ?? undefined,
        salary_currency: salaryComponent.currencyCode ?? undefined,
      }
    : undefined;

  return {
    raw_title: posting.title,
    // The slug is the only employer identity this API supplies, and it is the
    // stronger one anyway: company association looks a company up by slug
    // before it falls back to a name.
    raw_company_slug: slug,
    // Ashby publishes one date, so nothing fills posting_updated_date.
    posting_date: new Date(posting.publishedAt),
    raw_location_list,
    raw_mode_list,
    description,
    ...(raw_salary ? { raw_salary } : {}),
  };
}
