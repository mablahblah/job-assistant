// Converts a human-readable age string from a job listing into approximate days.
// Returns null if the string can't be parsed.
export function parseAgeToDays(age: string): number | null {
  const lower = age.toLowerCase().trim();
  if (!lower) return null;

  if (lower === "just now") return 0;
  if (lower === "yesterday") return 1;
  if (lower.includes("last week")) return 7;
  if (lower.includes("last month")) return 30;

  // "7 minutes ago", "17 hours ago", "6h" — anything sub-day
  if (/\d+\s*(hours?|minutes?|h\b|min\b)/i.test(lower)) return 0;

  // "3d", "3 days ago", "Posted 1 day ago"
  const dayMatch = lower.match(/(\d+)\s*d(ays?)?\b/i);
  if (dayMatch) return parseInt(dayMatch[1], 10);

  // "2w", "2 weeks ago"
  const weekMatch = lower.match(/(\d+)\s*w(eeks?)?\b/i);
  if (weekMatch) return parseInt(weekMatch[1], 10) * 7;

  // "1mo", "2 months ago"
  const monthMatch = lower.match(/(\d+)\s*mo(nths?)?\b/i);
  if (monthMatch) return parseInt(monthMatch[1], 10) * 30;

  // "1y", "2 years ago"
  const yearMatch = lower.match(/(\d+)\s*y(ears?)?\b/i);
  if (yearMatch) return parseInt(yearMatch[1], 10) * 365;

  return null;
}

// Returns true if the age string represents a job 8+ days old.
export function isStale(age: string): boolean {
  const days = parseAgeToDays(age);
  return days !== null && days >= 8;
}
