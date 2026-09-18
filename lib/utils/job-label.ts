import type { JobListEntry } from "../types/job-list-entry";

// A job's readable name, for a warning line the user reads.
//
// The title is the normalized one, falling back to the raw title where
// normalization left none. Either can arrive as an empty string rather than
// absent, and an empty string is no use as a label, so the fallback runs on
// emptiness and not only on absence; both are trimmed, since a source's stray
// whitespace would otherwise show up in the printed line. The id always tags
// along, because two jobs can show the same title.
//
// A job with no id at all reaches here only through a write that failed
// before the row existed, which is the thing the warning is reporting.
export function labelJob(job: JobListEntry): string {
  const label = job.title?.trim() || job.raw_title?.trim() || "unlabeled job";
  return `${label} (id: ${job.id ?? "unknown"})`;
}
