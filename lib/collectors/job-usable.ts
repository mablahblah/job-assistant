// Decides whether a freshly collected job can travel the rest of the pipeline.
// A field that is empty and needed, or filled and unusable, drops the job. A
// field that is empty and merely expected is fine, because an absent optional
// field is exactly what a source not publishing it looks like.
import type { JobListEntry } from "../job-list-entry";

// Every way a job can fail to be usable. This is the countable value: a
// message can embed a value like the offending URL, which would otherwise
// split one kind of failure into one group per value.
export type UnusableCode =
  | "no_original_url"
  | "original_url_not_a_url"
  | "no_raw_title"
  | "no_company_identity"
  | "posting_date_unparseable"
  | "posting_updated_date_unparseable";

export interface UnusableReason {
  code: UnusableCode;
  message: string;
  // The one value specific to this dropped job, bare and unquoted, for the
  // trace service to store as data. Most checks have nothing to put here.
  detail?: string;
}

// True when a field carries real content. Sources sometimes send an empty
// string rather than leaving the field off, so blank counts as missing. The
// return type narrows, which lets a caller use the value straight afterwards.
function isSupplied(value: string | null | undefined): value is string {
  return value != null && value.trim() !== "";
}

// A date is a problem only once it is set and fails to parse. Absent is fine
// and stays silent: JSearch leaves posting_date off some postings by design,
// and a parser fills it later. An Invalid Date left here travels unnoticed
// until it throws when the job is saved, several phases downstream.
function isUnparseableDate(value: Date | null | undefined): boolean {
  return value != null && Number.isNaN(value.getTime());
}

// The reason a job cannot travel, or null when it can. The code is what the
// caller counts by; the message is what the caller prints in its warning.
// Building the warning around these is the caller's job, so nothing here
// knows about collectors.
export function unusableReason(job: JobListEntry): UnusableReason | null {
  // Nothing downstream can resolve, parse, dedupe by URL, or apply to a job
  // without a link.
  if (!isSupplied(job.original_url)) {
    return { code: "no_original_url", message: "no original_url" };
  }

  // A link that is present still has to be a link. The URL constructor is the
  // one already-correct answer to what counts as one.
  try {
    new URL(job.original_url);
  } catch {
    return {
      code: "original_url_not_a_url",
      message: `original_url is not a URL: "${job.original_url}"`,
      detail: job.original_url,
    };
  }

  // Classification, content dedupe, and scoring all read the title.
  if (!isSupplied(job.raw_title)) {
    return { code: "no_raw_title", message: "no raw_title" };
  }

  // Either identity alone is enough. Phase 4 matches a company by slug first
  // and by name second, and Lever and Ashby supply only the slug while Adzuna
  // and JSearch supply only the name, so demanding both would drop every job
  // the pipeline collects.
  if (!isSupplied(job.raw_company_name) && !isSupplied(job.raw_company_slug)) {
    return {
      code: "no_company_identity",
      message: "no raw_company_name and no raw_company_slug",
    };
  }

  if (isUnparseableDate(job.posting_date)) {
    return { code: "posting_date_unparseable", message: "posting_date does not parse" };
  }

  if (isUnparseableDate(job.posting_updated_date)) {
    return {
      code: "posting_updated_date_unparseable",
      message: "posting_updated_date does not parse",
    };
  }

  return null;
}
