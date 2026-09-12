// Maps a Greenhouse posting's own fields into the shape both a collector and
// a parser write to the database. It does the mapping only — building the
// posting's link and stamping the phase gates belongs to whichever one calls
// this, since a parser already holds a resolved link and is about to close
// its own gate, and this mapper touching either would let one overwrite the
// other's work.
import type { MappedJobFields, RawSalary } from "./job-list-entry";

export interface GreenhousePayRange {
  min_cents: number;
  max_cents: number;
  currency_type: string;
}

export interface GreenhousePosting {
  id: number;
  title: string;
  first_published: string;
  updated_at: string;
  location?: { name: string };
  content?: string;
  pay_input_ranges?: GreenhousePayRange[];
  company_name?: string;
}

export interface GreenhouseJobsResponse {
  jobs: GreenhousePosting[];
}

export function jobFieldsFromGreenhousePosting(
  posting: GreenhousePosting,
  slug: string
): MappedJobFields {
  // A blank description is the same as none, so it is left unset.
  const description = posting.content || undefined;
  // Greenhouse sends cents, and the cents are written exactly as sent. No
  // figure carries its unit on its face, so which unit an API sends is a fact
  // this mapper records rather than acts on. A board with no range at all
  // and one with an empty range both mean no pay, and neither writes a salary.
  const range = posting.pay_input_ranges?.[0];
  const raw_salary: RawSalary | undefined = range
    ? {
        salary_min: range.min_cents,
        salary_max: range.max_cents,
        salary_currency: range.currency_type,
        salary_unit: "cents",
      }
    : undefined;
  return {
    raw_title: posting.title,
    // Every posting carries the employer's real name, so it is read straight
    // off the posting and costs no request of its own. A posting without one
    // leaves this empty rather than standing a name in for it.
    raw_company_name: posting.company_name,
    // Recorded beside the name because a slug is the stronger identity, and
    // company association looks a company up by slug first.
    raw_company_slug: slug,
    posting_date: new Date(posting.first_published),
    posting_updated_date: new Date(posting.updated_at),
    raw_location_list: posting.location ? [posting.location.name] : [],
    // Greenhouse publishes no work-mode field, so there is nothing to map
    // here. The mode is in the description, and reading it out is a parser's
    // job.
    raw_mode_list: [],
    description,
    ...(raw_salary ? { raw_salary } : {}),
  };
}
