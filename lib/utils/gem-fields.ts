// Maps a Gem posting's own fields into the shape both a collector and a
// parser write to the database. It does the mapping only — building the
// posting's link and stamping the phase gates belongs to whichever one calls
// this, since a parser already holds a resolved link and is about to close
// its own gate, and this mapper touching either would let one overwrite the
// other's work.
//
// Gem's API carries no employer name and publishes pay only inside the
// description, so a job records only the slug of the board it came from. The
// parser reads the description to extract compensation if present.
import type { MappedJobFields } from "../types/job-list-entry";

export interface GemPosting {
  absolute_url: string;
  id: string;
  title: string;
  content?: string;
  content_plain?: string;
  created_at?: string;
  first_published_at: string;
  updated_at?: string;
  location?: { name: string };
  location_type?: string | null;
  employment_type?: string;
}

export function jobFieldsFromGemPosting(posting: GemPosting, slug: string): MappedJobFields {
  // The plain-text field wins over the HTML one when both are present, and a
  // blank one counts as none.
  const description = posting.content_plain || posting.content || undefined;

  return {
    raw_title: posting.title,
    // The slug is the only employer identity this API supplies, and it is the
    // stronger one anyway: company association looks a company up by slug
    // before it falls back to a name.
    raw_company_slug: slug,
    // first_published_at is when the posting went live, not created_at when
    // the posting was drafted, which can be months earlier.
    posting_date: new Date(posting.first_published_at),
    raw_location_list: posting.location ? [posting.location.name] : [],
    // Stored exactly as Gem sends it — remote, hybrid, onsite, etc. Mapping
    // those words onto the three the app uses is normalization's job, and a
    // posting without the field leaves the list empty for a parser to fill.
    raw_mode_list: posting.location_type ? [posting.location_type] : [],
    description,
    ...(posting.updated_at ? { posting_updated_date: new Date(posting.updated_at) } : {}),
  };
}
