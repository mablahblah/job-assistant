// How long ago a date was, in the words a dashboard row uses.
//
// A posting's age is part of what the user is judging, so the row says how
// long ago rather than giving a calendar date the reader has to subtract from
// today. Whole days only: a part day left over is not rounded up, so a posting
// thirty hours old is a day old rather than two.
//
// The present moment is a second argument so a test can fix it rather than
// depend on the clock the suite happens to run under.
export function relativeDate(date: Date, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}
