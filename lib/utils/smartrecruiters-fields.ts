// Maps a SmartRecruiters posting's own fields into the shape both a
// collector and a parser write to the database. It does the mapping only —
// building the posting's link and stamping the phase gates belongs to
// whichever one calls this, since a parser already holds a resolved link and
// is about to close its own gate, and this mapper touching either would let
// one overwrite the other's work.
//
// SmartRecruiters publishes the employer's name on every posting, unlike
// Gem, Lever and Ashby, so a job records both the name and the slug of the
// board it came from. Pay appears only for some companies and only inside
// the job ad's text, so it is left entirely to the description fallback.
import type { MappedJobFields } from "../types/job-list-entry";

export interface SmartRecruitersPosting {
  id: string;
  name: string;
  company?: { identifier?: string; name?: string };
  releasedDate: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
    hybrid?: boolean;
    fullLocation?: string;
  };
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
}

export interface SmartRecruitersPostingsResponse {
  offset: number;
  limit: number;
  totalFound: number;
  content: SmartRecruitersPosting[];
}

// The order the description's sections are joined in. Kept even when a
// section's own words might seem redundant, because pay and work mode often
// sit in the additional information section, and the description fallback
// can only read what this mapper kept — dropping a section here could drop
// the only place that data ever shows up.
const DESCRIPTION_SECTION_ORDER = [
  "companyDescription",
  "jobDescription",
  "qualifications",
  "additionalInformation",
] as const;

function descriptionFromJobAd(posting: SmartRecruitersPosting): string | undefined {
  const sections = posting.jobAd?.sections;
  if (!sections) return undefined;

  const text = DESCRIPTION_SECTION_ORDER.map((key) => sections[key]?.text?.trim())
    .filter((sectionText): sectionText is string => Boolean(sectionText))
    .join("\n");

  return text.length > 0 ? text : undefined;
}

export function jobFieldsFromSmartRecruitersPosting(
  posting: SmartRecruitersPosting,
  slug: string,
): MappedJobFields {
  const location = posting.location;

  return {
    raw_title: posting.name,
    raw_company_name: posting.company?.name,
    raw_company_slug: slug,
    posting_date: new Date(posting.releasedDate),
    raw_location_list: location?.fullLocation ? [location.fullLocation] : [],
    // Two false flags say nothing certain — an office-only posting and one
    // whose employer never set the flags look the same — so the list stays
    // empty for the parser's description fallback rather than guessing.
    raw_mode_list: location?.remote ? ["remote"] : location?.hybrid ? ["hybrid"] : [],
    description: descriptionFromJobAd(posting),
  };
}
