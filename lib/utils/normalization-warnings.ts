// Folds many unusable-field reports from normalization into one warning line
// per collector per reason. A search collects around 1,800 jobs; if one
// collector starts sending broken salaries, printing a line per job would
// bury every other warning in the run. Grouping them down to a count and a
// couple of examples keeps a broken source visible without drowning out
// anything else.
import type { CollectionIssue } from "../types/collection-issue";

export interface UnusableField {
  collector: string;
  reason: string;
  example: string; // the raw value that could not be used
}

// The only two normalization reasons that ever warn. The normalizer records
// nine in total; the other seven land in the trace table and are dropped
// here rather than printed.
export const WARNING_REASONS = ["salary_unusable", "work_mode_unusable"] as const;

// How many raw examples ride along in a folded warning. Enough to recognise
// the shape of what broke, not so many the line turns back into a list.
const EXAMPLE_LIMIT = 2;

type WarningReason = (typeof WARNING_REASONS)[number];

function isWarningReason(reason: string): reason is WarningReason {
  return (WARNING_REASONS as readonly string[]).includes(reason);
}

interface Group {
  collector: string;
  reason: WarningReason;
  count: number;
  examples: string[];
}

export function summarizeNormalizationWarnings(unusable: UnusableField[]): CollectionIssue[] {
  // Keyed by collector and reason together, so one collector reporting two
  // reasons folds into two issues rather than one. A Map keeps insertion
  // order, which is what makes the issues and their examples come back in
  // the order they arrived.
  const grouped = new Map<string, Group>();

  for (const field of unusable) {
    // One of the seven silent reasons. Skipped before counting, so it never
    // inflates the figure a warning reason reports.
    if (!isWarningReason(field.reason)) continue;

    // A null character separates the two parts of the key, so a collector
    // name can never run into a reason and collide with another group.
    const key = `${field.collector}\u0000${field.reason}`;
    let group = grouped.get(key);
    if (group === undefined) {
      group = { collector: field.collector, reason: field.reason, count: 0, examples: [] };
      grouped.set(key, group);
    }

    // The count grows but the examples do not, so a collector sending
    // hundreds of broken jobs still costs two strings rather than hundreds.
    group.count += 1;
    if (group.examples.length < EXAMPLE_LIMIT) {
      group.examples.push(field.example); // printed verbatim, never re-escaped
    }
  }

  return Array.from(grouped.values(), (group) => ({
    collector: group.collector,
    message: `${group.reason} on ${group.count} ${group.count === 1 ? "job" : "jobs"}, e.g. ${group.examples.join(", ")}`,
  }));
}
