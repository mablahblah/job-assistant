// A job found by a collector. Only url and source are guaranteed —
// everything else is optional metadata from APIs that don't require extra fetching.
export interface CollectedJob {
  url: string;
  source: string;
  externalId?: string;
  title?: string;
  companyName?: string;
  location?: string;
  workMode?: string;
  dates?: Date[];
  salaryRange?: string;
  description?: string;
}

// Result summary from a single collector run
export interface CollectorResult {
  source: string;
  jobs: CollectedJob[];
  error?: string;
  warnings?: string[];
}
