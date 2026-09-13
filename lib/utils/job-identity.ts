import type { JobListEntry } from "../types/job-list-entry";
import { urlMatchKey } from "./url-match-key";

// The three ways two entries are recognized as one job, tried in this order.
// A shared link is proof and stands on its own; company and title is a guess,
// so it is tried last and only where the dates back it up. The exact strings
// are written into a trace row, so they are never renamed or reworded.
export type JobIdentityClause = "original_url" | "resolved_url" | "company_and_title";

const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
const COMPANY_AND_TITLE_WINDOW_DAYS = 30;
const COMPANY_AND_TITLE_WINDOW_MS = COMPANY_AND_TITLE_WINDOW_DAYS * ONE_DAY_IN_MS;

// Fires where both sides carry the same link, read through its match key so a
// differing query string still counts as the same posting. Either side
// missing the field, or either link failing to parse, silences the clause —
// two absent links are never a match.
//
// The key is built from the link rather than read off the entry's match-key
// column, because the job service writes that column at write time and an
// entry fresh from a collector has not been written yet.
function linksMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const keyA = urlMatchKey(a);
  const keyB = urlMatchKey(b);
  return keyA != null && keyB != null && keyA === keyB;
}

// A side's latest date: its updated date where it has one, otherwise its
// posted date. Null where neither is present, so the clause reading it knows
// to stay silent rather than compare a real date against nothing.
function latestDate(entry: JobListEntry): Date | null {
  return entry.posting_updated_date ?? entry.posting_date ?? null;
}

// The host a resolved link points at, or null where it does not parse. A
// separate question from whether two links are the same posting, which
// urlMatchKey already answers.
function resolvedHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// Two posting ids on one job board are two openings at that company rather
// than one job seen twice, so a pair of resolved links sharing a host but
// keying differently blocks the company-and-title clause. A resolved link is
// the posting itself rather than a listing pointing at one, which is what
// makes the host alone enough once the company has already matched.
//
// No veto unless both sides carry a resolved link that parses.
function sharedHostVeto(a: JobListEntry, b: JobListEntry): boolean {
  if (a.resolved_url == null || b.resolved_url == null) return false;
  const hostA = resolvedHost(a.resolved_url);
  const hostB = resolvedHost(b.resolved_url);
  if (hostA == null || hostB == null || hostA !== hostB) return false;
  // Both hosts parsed, so neither key comes back null here.
  return urlMatchKey(a.resolved_url) !== urlMatchKey(b.resolved_url);
}

// Fires where both sides share a company and a normalized title and their
// latest dates fall inside the window. Thirty days covers 81% of the reposts
// measured in the old database, and a genuinely new role carrying the same
// title is unlikely to be posted that soon after the last one.
//
// Every field it reads has to be present on both sides, and the shared-host
// veto above can still block it where company, title and dates all line up.
function companyAndTitleMatch(a: JobListEntry, b: JobListEntry): boolean {
  if (a.company_id == null || b.company_id == null || a.company_id !== b.company_id) {
    return false;
  }
  // The normalized title, never raw_title — matching one role across sources
  // that spell it differently is the reason normalization exists.
  if (a.title == null || b.title == null || a.title !== b.title) return false;

  const dateA = latestDate(a);
  const dateB = latestDate(b);
  if (dateA == null || dateB == null) return false;

  const apartInMs = Math.abs(dateA.getTime() - dateB.getTime());
  if (apartInMs > COMPANY_AND_TITLE_WINDOW_MS) return false;

  return !sharedHostVeto(a, b);
}

// Answers "are these two entries the same job", trying each clause in order
// and naming the first that fires. No clause reads which collector found a
// job. Reads no database and mutates neither argument.
export function matchingClause(a: JobListEntry, b: JobListEntry): JobIdentityClause | null {
  if (linksMatch(a.original_url, b.original_url)) return "original_url";
  if (linksMatch(a.resolved_url, b.resolved_url)) return "resolved_url";
  if (companyAndTitleMatch(a, b)) return "company_and_title";
  return null;
}
