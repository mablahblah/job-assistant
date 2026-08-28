// Decides whether a freshly collected job can travel the rest of the pipeline.
// A field that is empty and needed, or filled and unusable, drops the job. A
// field that is empty and merely expected is fine, because an absent optional
// field is exactly what a source not publishing it looks like.
import type { JobListEntry } from "../job-list-entry";

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

// The reason a job cannot travel, or null when it can. Building the warning
// around this reason is the caller's job, so nothing here knows about
// collectors.
export function unusableReason(job: JobListEntry): string | null {
  // Nothing downstream can resolve, parse, dedupe by URL, or apply to a job
  // without a link.
  if (!isSupplied(job.original_url)) {
    return "no original_url";
  }

  // A link that is present still has to be a link. The URL constructor is the
  // one already-correct answer to what counts as one.
  try {
    new URL(job.original_url);
  } catch {
    return `original_url is not a URL: "${job.original_url}"`;
  }

  // Classification, content dedupe, and scoring all read the title.
  if (!isSupplied(job.raw_title)) {
    return "no raw_title";
  }

  // Either identity alone is enough. Phase 4 matches a company by slug first
  // and by name second, and Lever and Ashby supply only the slug while Adzuna
  // and JSearch supply only the name, so demanding both would drop every job
  // the pipeline collects.
  if (!isSupplied(job.raw_company_name) && !isSupplied(job.raw_company_slug)) {
    return "no raw_company_name and no raw_company_slug";
  }

  if (isUnparseableDate(job.posting_date)) {
    return "posting_date does not parse";
  }

  if (isUnparseableDate(job.posting_updated_date)) {
    return "posting_updated_date does not parse";
  }

  return null;
}
