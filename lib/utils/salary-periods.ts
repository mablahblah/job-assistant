// The five periods a published pay figure can be quoted in, and what each is
// worth in a year. A day is 260 and an hour 2080, which is a five-day week
// over fifty-two weeks.
//
// One list rather than two, because both the score formula and the dashboard's
// pay column have to agree about which words they can read. A period outside
// this list is not turned into a yearly figure and not shown as pay, since a
// word the pipeline does not recognise is evidence the figure is not yearly.
export const YEARLY_MULTIPLIERS: Record<string, number> = {
  year: 1,
  month: 12,
  week: 52,
  day: 260,
  hour: 2080,
};

// True when a stored period is one the two readers above can act on.
export function isReadablePeriod(period: string | null | undefined): boolean {
  return period != null && period in YEARLY_MULTIPLIERS;
}
