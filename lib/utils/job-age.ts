// Reads the relative age strings job cards carry, so "3 days ago" and "1mo"
// mean the same thing to every collector. A browser collector uses this to
// decide when a listing is old enough to stop paginating.
//
// It also holds the one measurement of a saved job's age, which backlog
// cleanup, promotion and classification all call, so the clock cannot drift
// between them.
import type { JobDateFields } from "./job-dates";
import { DAY_MS } from "./durations";

// collected_at is always present once a job is saved, unlike the two date
// fields it joins — this is the shape a caller measuring age actually holds.
export interface JobAgeFields extends JobDateFields {
  collected_at: Date;
}

// Every unit below captures its number in the first group, so pulling that
// number out lives here rather than at each match.
function capturedNumber(match: RegExpMatchArray): number {
  return parseInt(match[1], 10);
}

// Approximate days old, or null when the string holds no age this recognises.
// Null is the signal a collector acts on: it stops paginating and reports the
// string as written, so a site rewording its cards cannot pass unnoticed.
export function parseAgeToDays(age: string): number | null {
  const lower = age.toLowerCase().trim();
  if (!lower) return null;

  if (lower === "just now") return 0;
  if (lower === "yesterday") return 1;
  if (lower.includes("last week")) return 7;
  if (lower.includes("last month")) return 30;

  // "7 minutes ago", "17 hours ago", "6h" — anything short of a day is today.
  if (/\d+\s*(hours?|minutes?|h\b|min\b)/i.test(lower)) return 0;

  // "3d", "3 days ago", "Posted 1 day ago"
  const dayMatch = lower.match(/(\d+)\s*d(ays?)?\b/i);
  if (dayMatch) return capturedNumber(dayMatch);

  // "2w", "2 weeks ago"
  const weekMatch = lower.match(/(\d+)\s*w(eeks?)?\b/i);
  if (weekMatch) return capturedNumber(weekMatch) * 7;

  // "1mo", "2 months ago". A month is a flat 30 days, which is close enough
  // for deciding whether a listing is worth reading.
  const monthMatch = lower.match(/(\d+)\s*mo(nths?)?\b/i);
  if (monthMatch) return capturedNumber(monthMatch) * 30;

  // "1y", "2 years ago"
  const yearMatch = lower.match(/(\d+)\s*y(ears?)?\b/i);
  if (yearMatch) return capturedNumber(yearMatch) * 365;

  return null;
}

// Inclusive: a job exactly `threshold` days old counts as past it. It takes
// days rather than the age string, so a caller that skipped the null check
// from parseAgeToDays fails to compile instead of failing quietly.
export function isPastThreshold(days: number, threshold: number): boolean {
  return days >= threshold;
}

// The date a relative age points at, measured back from `now`. Approximate,
// because the string it reads is approximate.
export function ageToDate(age: string, now: Date = new Date()): Date | null {
  const days = parseAgeToDays(age);
  if (days === null) return null;
  return new Date(now.getTime() - days * DAY_MS);
}

// The date a source last changed a posting is closer to its real age than the
// date it went live, which is why an update beats a posted date. The day this
// pipeline first saw the job is only a fallback for a posting carrying
// neither, since a source's own dates outrank our bookkeeping.
//
// Neither the row's modified_at nor its created_at is read. Writing a status
// moves modified_at, so a rule reading it would make every job look freshly
// posted the instant its status was written.
//
// The answer is an exact duration rather than a count of calendar days, and
// the reference instant is handed in rather than read from the clock, because
// a whole run measures against the instant it started with.
export function jobAgeInDays(job: JobAgeFields, referenceInstant: Date): number {
  const anchor = job.posting_updated_date ?? job.posting_date ?? job.collected_at;
  const ageInDays = (referenceInstant.getTime() - anchor.getTime()) / DAY_MS;
  // A posting dated after the reference instant is not old at all, rather
  // than owing a negative age no threshold could read.
  return Math.max(0, ageInDays);
}
