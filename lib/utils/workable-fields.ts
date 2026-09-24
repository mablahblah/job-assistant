// Workable's company site serves two different shapes of the same job, and
// its job search site serves a third. The posting —
// apply.workable.com/api/v2/accounts/{board}/jobs/{shortcode}, the address
// the company site's own page calls — carries a job's full text but no
// employer name. The widget — the documented
// apply.workable.com/api/v1/widget/accounts/{board} — lists every job on a
// board and names the employer, but gives no job its own description. The
// search-site job — jobs.workable.com/api/v1/jobs/{id} — names the employer
// on the job itself but never its board slug. A collector or parser picks
// whichever shape it read and maps it here; no mapper builds the posting's
// link or touches a phase gate, since a parser already holds a resolved link
// and is about to close its own gate, and this mapper touching either would
// let one overwrite the other's work.
import type { MappedJobFields } from "../types/job-list-entry";
import { placeFromParts } from "./place-from-parts";

export interface WorkablePosting {
  id?: number;
  shortcode: string;
  title: string;
  remote?: boolean;
  location?: {
    countryCode?: string;
    country?: string;
    region?: string;
    city?: string;
    display?: string;
  };
  published?: string;
  workplace?: string | null;
  description?: string;
  requirements?: string;
  benefits?: string;
}

export interface WorkableListing {
  title: string;
  shortcode: string;
  employment_type?: string;
  telecommuting?: boolean;
  url?: string;
  shortlink?: string;
  published_on?: string;
  created_at?: string;
  country?: string;
  city?: string;
  state?: string;
}

export interface WorkableWidget {
  name?: string;
  description?: string;
  jobs: WorkableListing[];
}

export interface WorkableSearchJob {
  company: {
    id?: string;
    title: string;
    description?: string;
    url?: string;
    website?: string;
  };
  created?: string;
  description?: string;
  requirementsSection?: string;
  benefitsSection?: string;
  employmentType?: string;
  id?: string;
  location?: {
    city?: string | null;
    countryName?: string | null;
    subregion?: string | null;
  };
  locations?: string[];
  state?: string;
  title: string;
  updated?: string;
  url?: string;
  workplace?: string | null;
}

// The role, its requirements and its benefits are three separate fields
// Workable sends; a parser expects them joined into one description.
function joinDescription(parts: Array<string | undefined>): string | undefined {
  return (
    parts.filter((part): part is string => Boolean(part && part.trim())).join("\n") || undefined
  );
}

export function jobFieldsFromWorkablePosting(
  posting: WorkablePosting,
  slug: string,
): MappedJobFields {
  // The posting has no employer name at all, so the board slug is the only
  // company identity a job gets from this shape.
  const location = posting.location;
  const place = location
    ? location.display || placeFromParts([location.city, location.region, location.country])
    : undefined;

  const description = joinDescription([posting.description, posting.requirements, posting.benefits]);

  return {
    raw_title: posting.title,
    raw_company_slug: slug,
    raw_location_list: place ? [place] : [],
    // Stored exactly as Workable sends it. A posting with no workplace field
    // leaves the list empty for the parser's description fallback to fill.
    raw_mode_list: posting.workplace ? [posting.workplace] : [],
    description,
    ...(posting.published ? { posting_date: new Date(posting.published) } : {}),
  };
}

export function jobFieldsFromWorkableListing(
  listing: WorkableListing,
  slug: string,
): MappedJobFields {
  const place = placeFromParts([listing.city, listing.state, listing.country]);

  return {
    raw_title: listing.title,
    raw_company_slug: slug,
    raw_location_list: place ? [place] : [],
    // The widget only ever flags remote work; anything else is left for the
    // parser to work out.
    raw_mode_list: listing.telecommuting === true ? ["remote"] : [],
    ...(listing.published_on ? { posting_date: new Date(listing.published_on) } : {}),
  };
}

export function jobFieldsFromWorkableSearchJob(job: WorkableSearchJob): MappedJobFields {
  // Unlike the other two shapes, the search site names the employer on the
  // job itself — but never its board, so no raw_company_slug is set here;
  // the parser fills that in later, after guessing.
  const location = job.location;
  const place = location
    ? placeFromParts([location.city, location.subregion, location.countryName])
    : undefined;

  const description = joinDescription([job.description, job.requirementsSection, job.benefitsSection]);

  return {
    raw_title: job.title,
    raw_company_name: job.company.title,
    raw_location_list: place ? [place] : [],
    // Stored exactly as Workable sends it. A job with no workplace field
    // leaves the list empty for a parser to fill.
    raw_mode_list: job.workplace ? [job.workplace] : [],
    description,
    ...(job.created ? { posting_date: new Date(job.created) } : {}),
  };
}
