// The weeks a work log is read in. The Texas Workforce Commission's benefit
// week runs Sunday to Saturday, and the form is filed one week at a time, so
// the week is what the page groups by.
//
// Local time throughout, deliberately: a benefit week is a run of local days
// rather than a fixed number of hours.
import type { WorkLogRow } from "../types/work-log-row";

// The Sunday at midnight that opens the week a date falls in.
export function weekStart(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

// Every week from the first filing to today, newest first. Every week is
// listed rather than only the weeks holding entries, because a week nothing
// was filed in still has to appear and say so.
export function weekList(earliest: Date, now: Date): Date[] {
  const weeks: Date[] = [];
  const firstWeek = weekStart(earliest);
  let week = weekStart(now);

  while (week >= firstWeek) {
    weeks.push(new Date(week));
    week = new Date(week);
    week.setDate(week.getDate() - 7);
  }

  return weeks;
}

// Each entry under the week it was written in, keyed by that week's start.
// The entry's own written date decides its week, because that is the week the
// form it feeds is filed for.
export function groupByWeek(rows: WorkLogRow[]): Map<string, WorkLogRow[]> {
  const weeks = new Map<string, WorkLogRow[]>();

  for (const row of rows) {
    const key = weekStart(row.entry.created_at).toISOString();
    const held = weeks.get(key) ?? [];
    held.push(row);
    weeks.set(key, held);
  }

  return weeks;
}

// The sidebar and each week's heading both name a week, and the name has to be
// the span of days the form is filed for rather than one date. The year sits on
// the closing day, so a week crossing new year still reads correctly.
export function weekLabel(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const dayAndMonth: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const opens = start.toLocaleDateString("en-US", dayAndMonth);
  const closes = end.toLocaleDateString("en-US", { ...dayAndMonth, year: "numeric" });
  return `${opens} – ${closes}`;
}
