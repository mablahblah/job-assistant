// Pure utility functions for TWC weekly work search log grouping.
// TWC benefit weeks run Sunday–Saturday.

export const MIN_WEEKLY_ACTIVITIES = 3;

// Returns the Sunday 00:00:00 of the week containing `date`
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  return d;
}

// Returns the Saturday 23:59:59 of the week starting at `weekStart`
export function getWeekEnd(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Generates all week start dates (Sundays) from `earliest` up to `now`, most recent first
export function generateWeekSlots(earliest: Date, now: Date): Date[] {
  const slots: Date[] = [];
  let current = getWeekStart(now);
  const floor = getWeekStart(earliest);

  while (current >= floor) {
    slots.push(new Date(current));
    current = new Date(current);
    current.setDate(current.getDate() - 7);
  }

  return slots; // most recent first
}

// Groups entries by their week-start ISO string; returns a Map preserving insertion (most-recent) order
export function groupEntriesByWeek<T extends { date: string }>(
  entries: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();

  for (const entry of entries) {
    const weekStart = getWeekStart(new Date(entry.date));
    const key = weekStart.toISOString();
    const bucket = map.get(key) ?? [];
    bucket.push(entry);
    map.set(key, bucket);
  }

  return map;
}

// Formats a week label like "Apr 5 – Apr 11, 2026"
export function formatWeekLabel(start: Date): string {
  const end = getWeekEnd(start);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startStr = start.toLocaleDateString("en-US", opts);
  const endStr = end.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${startStr} – ${endStr}`;
}

// Human-readable labels for enrichment flag keys
const FLAG_LABELS: Record<string, string> = {
  address_outside_us: "Address may be outside US",
  name_mismatch: "Company name may not match",
  missing_data: "Contact info incomplete",
  missing_address: "Address not found",
  missing_phone: "Phone not found",
  missing_website: "Website not found",
};

// Maps a comma-separated enrichmentFlags string to readable label array
export function parseEnrichmentFlags(flags: string | null): string[] {
  if (!flags) return [];
  return flags
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => FLAG_LABELS[f] ?? f);
}
