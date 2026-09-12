// Maps a Lever posting's own fields into the shape both a collector and a
// parser write to the database. It does the mapping only — building the
// posting's link and stamping the phase gates belongs to whichever one calls
// this, since a parser already holds a resolved link and is about to close
// its own gate, and this mapper touching either would let one overwrite the
// other's work.
//
// Lever's API carries no employer name at all, so a job records only the
// slug of the board it came from. The parser reads the name off the board
// page's title instead.
import type { MappedJobFields } from "./job-list-entry";

export interface LeverPosting {
  id: string;
  text: string;
  createdAt: number;
  categories?: { location?: string; team?: string };
  workplaceType?: string;
  descriptionPlain?: string;
  description?: string;
}

export function jobFieldsFromLeverPosting(posting: LeverPosting, slug: string): MappedJobFields {
  // The plain-text field wins over the HTML one when both are present, and a
  // blank one counts as none.
  const description = posting.descriptionPlain || posting.description || undefined;
  return {
    raw_title: posting.text,
    // The slug is the only employer identity this API supplies, and it is the
    // stronger one anyway: company association looks a company up by slug
    // before it falls back to a name.
    raw_company_slug: slug,
    // Lever publishes one date, so nothing fills posting_updated_date.
    posting_date: new Date(posting.createdAt),
    raw_location_list: posting.categories?.location ? [posting.categories.location] : [],
    // Stored exactly as Lever sends it — remote, hybrid, or onsite. Mapping
    // those words onto the three the app uses is normalization's job, and a
    // posting without the field leaves the list empty for a parser to fill.
    raw_mode_list: posting.workplaceType ? [posting.workplaceType] : [],
    description,
  };
}
