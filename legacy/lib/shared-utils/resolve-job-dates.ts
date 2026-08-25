// Resolves dates for a job by pooling all available dates.
// Oldest becomes firstPublished, newest (if different) becomes repostedAt.
export function resolveJobDates(
  current: { firstPublished: Date; repostedAt: Date | null } | null,
  newDates: Date[],
): { firstPublished: Date; repostedAt: Date | null } {
  // No data at all — use today as the fallback (single fallback point for missing dates)
  if (current === null && newDates.length === 0) {
    return { firstPublished: new Date(), repostedAt: null };
  }

  // Nothing new — return existing state unchanged
  if (newDates.length === 0 && current !== null) {
    return { firstPublished: current.firstPublished, repostedAt: current.repostedAt };
  }

  // Pool all available dates
  const pool: Date[] = [...newDates];
  if (current !== null) {
    pool.push(current.firstPublished);
    if (current.repostedAt !== null) {
      pool.push(current.repostedAt);
    }
  }

  // Find oldest and newest by timestamp
  const oldest = new Date(Math.min(...pool.map((d) => d.getTime())));
  const newest = new Date(Math.max(...pool.map((d) => d.getTime())));

  return {
    firstPublished: oldest,
    repostedAt: oldest.getTime() === newest.getTime() ? null : newest,
  };
}
