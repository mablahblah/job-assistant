// Maps a Rippling job's own fields into the shape both a collector and a
// parser write to the database. It does the mapping only — building the
// posting's link and stamping the phase gates belongs to whichever one calls
// this, since a parser already holds a resolved link and is about to close
// its own gate, and this mapper touching either would let one overwrite the
// other's work.
import type { MappedJobFields, RawSalary } from "../types/job-list-entry";

export interface RipplingPayRange {
  location?: string;
  currency?: string;
  frequency?: string;
  rangeStart?: number;
  rangeEnd?: number;
  isRemote?: boolean;
}

export interface RipplingJob {
  uuid: string;
  name: string;
  description?: { company?: string; role?: string };
  workLocations?: string[]; // present on a single job's own detail
  workLocation?: { label?: string; id?: string }; // present on a board list entry
  department?: { name?: string; label?: string; id?: string };
  employmentType?: { label?: string; id?: string };
  createdOn?: string;
  url?: string;
  board?: { slug?: string; companyName?: string };
  payRangeDetails?: RipplingPayRange[];
  companyName?: string;
}

export function jobFieldsFromRipplingJob(job: RipplingJob, slug: string): MappedJobFields {
  // A board list entry names no employer directly, so the board's own name
  // for itself stands in.
  const companyName = job.companyName ?? job.board?.companyName ?? undefined;

  // A full job detail carries every location; a list entry carries just one.
  const locationList =
    job.workLocations && job.workLocations.length > 0
      ? job.workLocations
      : job.workLocation?.label
        ? [job.workLocation.label]
        : [];

  // Rippling publishes no work-mode field of its own; the parser's
  // description fallback fills raw_mode_list from the description text.
  const modeList: string[] = [];

  // The description arrives as two halves — the company's pitch, then the
  // role's — kept in that order and joined only when either is present. A
  // list entry carries neither half.
  const descriptionParts = [job.description?.company, job.description?.role].filter(
    (part): part is string => Boolean(part),
  );
  const description = descriptionParts.length > 0 ? descriptionParts.join("\n") : undefined;

  // The first pay range, kept exactly as Rippling wrote it — whole currency
  // units, so no salary_unit, and no normalizing "YEAR" here. An empty or
  // absent list writes no raw_salary key, leaving the description fallback
  // to supply pay instead.
  const firstRange = job.payRangeDetails?.[0];
  const salary: RawSalary | undefined = firstRange
    ? {
        salary_min: firstRange.rangeStart,
        salary_max: firstRange.rangeEnd,
        salary_currency: firstRange.currency,
        salary_period: firstRange.frequency,
      }
    : undefined;

  return {
    raw_title: job.name,
    raw_company_slug: slug,
    ...(companyName ? { raw_company_name: companyName } : {}),
    raw_location_list: locationList,
    raw_mode_list: modeList,
    ...(description ? { description } : {}),
    ...(job.createdOn ? { posting_date: new Date(job.createdOn) } : {}),
    ...(salary ? { raw_salary: salary } : {}),
  };
}
