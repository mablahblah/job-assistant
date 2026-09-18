// The written reasoning behind a job's total, for the browser tooltip hanging
// off that total.
//
// Only the job's own reasoning. The employer's four categories were tried here
// first and judged by eye on 2026-09-17: five blocks came to 2,848 characters,
// which is more than a browser tooltip can show. They wait for a hover panel
// that can hold them, which is display work this phase does not do.
//
// No heading either, because one block of text hanging off one number has
// nothing to be headed apart from.
import type { JobRow } from "../types/job-row";

export function scoreReasoning(row: JobRow): string | null {
  const written = row.job.alignment_rationale;

  // Nothing at all rather than an empty string, so the row can leave the
  // tooltip off instead of opening one onto blank space.
  if (written == null || written.trim().length === 0) return null;

  return written;
}
