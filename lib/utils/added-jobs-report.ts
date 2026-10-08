// The lines a command prints for an add-external-jobs run's results. Turns
// each job outcome, collected warnings, and any failure into the lines the
// command displays. Handed back as lines rather than printed directly, so
// what a command says can be proved without capturing output.

import type { AddedJobOutcome } from "../types/added-job-outcome";
import type { CollectionIssue } from "../types/collection-issue";
import type { RunFailure } from "./run-failure";
import { issueLines } from "./print-issues";

export interface AddedJobsRun {
  outcomes: AddedJobOutcome[];
  warnings: CollectionIssue[];
  handlers: { step: string; entries: number }[];
  failure: RunFailure | null;
}

export function addedJobsReport(run: AddedJobsRun): string[] {
  const lines: string[] = [];

  for (const outcome of run.outcomes) {
    if (outcome.jobId === null) {
      lines.push(`- ${outcome.link}: not added (${outcome.reason})`);
    } else {
      // A job saved with no title is named by its link, so the line still
      // points at something the user can open.
      const title = outcome.title ?? outcome.link;
      const employer = outcome.employer ?? "an unknown employer";
      let line = `- ${title} at ${employer}: ${outcome.status}`;

      if (outcome.reason) {
        line += ` (reason: ${outcome.reason})`;
      }

      if (outcome.letThroughReasons.length > 0) {
        line += ` — could not be judged for certain (${outcome.letThroughReasons.join(", ")})`;
      }

      lines.push(line);
    }
  }

  lines.push(...issueLines("Warnings", run.warnings));

  // Printed only on failure. A finished run has no question to answer about
  // which steps got that far.
  if (run.failure) {
    lines.push(`Run stopped at ${run.failure.at}: ${run.failure.reason}`);
    lines.push("Finished before it stopped:");
    for (const handler of run.handlers) {
      lines.push(`  - ${handler.step}: ${handler.entries} entries`);
    }
  }

  return lines;
}
