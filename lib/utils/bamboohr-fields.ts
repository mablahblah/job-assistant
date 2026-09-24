// Maps a BambooHR job opening's own fields into the shape both a collector
// and a parser write to the database. It does the mapping only — building
// the posting's link and stamping the phase gates belongs to whichever one
// calls this, for the same reason the Gem mapper stays out of that work: a
// parser already holds a resolved link and is about to close its own gate,
// and this mapper touching either would let one overwrite the other's work.
//
// BambooHR's API carries no employer name in either the list or the detail
// reply (measured 2026-09-24), so a job records only the slug of the board
// it came from. The free-text pay field is left for the parser to read:
// turning pay text into numbers is going looking, which a collector never
// does.
import type { MappedJobFields } from "../types/job-list-entry";
import { placeFromParts } from "./place-from-parts";

export interface BambooHrJob {
  id?: string;
  jobOpeningName: string;
  departmentLabel?: string;
  employmentStatusLabel?: string;
  location?: { city?: string | null; state?: string | null };
  atsLocation?: {
    country?: string | null;
    state?: string | null;
    province?: string | null;
    city?: string | null;
  };
  isRemote?: boolean | null;
  description?: string;
  datePosted?: string;
  // Free text, e.g. "145k-185k" (measured 2026-09-24, shortcut job 40).
  compensation?: string | null;
}

export interface BambooHrListResponse {
  result: BambooHrJob[];
}

export interface BambooHrDetailResponse {
  result: { jobOpening: BambooHrJob };
}

export function jobFieldsFromBambooHrJob(job: BambooHrJob, slug: string): MappedJobFields {
  // atsLocation is the richer, ATS-facing field and wins when it names a
  // place; the plainer location is what's left for boards that only fill
  // that one in.
  const atsPlace = job.atsLocation
    ? placeFromParts([
        job.atsLocation.city,
        job.atsLocation.state ?? job.atsLocation.province,
        job.atsLocation.country,
      ])
    : undefined;
  const plainPlace = job.location
    ? placeFromParts([job.location.city, job.location.state])
    : undefined;
  const place = atsPlace ?? plainPlace;

  return {
    raw_title: job.jobOpeningName,
    // The slug is the only employer identity this API supplies.
    raw_company_slug: slug,
    raw_location_list: place ? [place] : [],
    // Only the explicit remote flag is trusted; locationType's own values
    // were never measured, so reading it would be a guess encoded as code.
    raw_mode_list: job.isRemote === true ? ["remote"] : [],
    description: job.description || undefined,
    // A list entry carries no date at all, so the key is left off rather
    // than written as an invalid date.
    ...(job.datePosted ? { posting_date: new Date(job.datePosted) } : {}),
  };
}
