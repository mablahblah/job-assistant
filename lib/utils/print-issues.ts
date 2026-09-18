// The lines a command prints for the errors or warnings a run reported. One
// line per issue, naming both the source and its own message, since that
// message is what names the board or search behind it.
//
// Hands back lines rather than printing them, the same way the status change
// report does, so what a command says can be proved without capturing output.
// Shared rather than copied: three commands each held a byte-for-byte copy,
// so the shape of a reported problem had three places to change.
import type { CollectionIssue } from "../types/collection-issue";

export function issueLines(label: string, issues: CollectionIssue[]): string[] {
  // Said out loud rather than left blank. A heading with nothing under it
  // reads as a command that printed badly, not as a run with nothing wrong.
  if (issues.length === 0) return [`${label}: none`];

  return [`${label}:`, ...issues.map((issue) => `  ${issue.collector}: ${issue.message}`)];
}
