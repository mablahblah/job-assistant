// Reads the relative age strings job cards carry, so "3 days ago" and "1mo"
// mean the same thing to every collector. A browser collector uses this to
// decide when a listing is old enough to stop paginating.

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
  return new Date(now.getTime() - days * 86400000);
}
