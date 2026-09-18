// A side that may carry a job's posted and updated dates. Either field can be
// missing or null — both mean the same thing: no date on that field.
export interface JobDateFields {
  posting_date?: Date | null;
  posting_updated_date?: Date | null;
}

// The settled dates for a job. posting_date always has a value, because a job
// with no date anywhere falls back to when the pipeline first saw it.
export interface PooledJobDates {
  posting_date: Date;
  posting_updated_date: Date | null;
}

// Pools every date two sources hold for one job and settles which is posted
// and which is updated. Save pools an arriving entry against the stored row,
// and dedupe pools two entries where neither has a row at all, so both sides
// are plain date carriers and the second may be absent.
//
// Whether the gap between two dates is wide enough to call a repost is a
// judgement about the job, and belongs to classification rather than here.
export function poolJobDates(
  one: JobDateFields,
  two: JobDateFields | null,
  collectedAt: Date
): PooledJobDates {
  const candidates = [
    one.posting_date,
    one.posting_updated_date,
    two?.posting_date,
    two?.posting_updated_date,
  ].filter((date): date is Date => date != null);

  // Repeats match on the exact millisecond, so two collectors disagreeing by
  // hours on one calendar day produce two dates rather than one.
  const timestamps = [...new Set(candidates.map((date) => date.getTime()))];

  // No real date anywhere. When this pipeline first saw the posting is the
  // closest honest stand-in for when it went live, and it is never pooled
  // alongside dates that do exist.
  if (timestamps.length === 0) {
    return { posting_date: collectedAt, posting_updated_date: null };
  }

  const earliest = new Date(Math.min(...timestamps));

  // One distinct date leaves nothing to call an update.
  if (timestamps.length === 1) {
    return { posting_date: earliest, posting_updated_date: null };
  }

  return { posting_date: earliest, posting_updated_date: new Date(Math.max(...timestamps)) };
}
