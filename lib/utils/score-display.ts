// The three small turns the dashboard makes before a score reaches the page.
// The thresholds are the ones the old dashboard used, because this phase
// changes nothing about how the page looks.

// A job's total into the class name that colours it. An unscored job has no
// total at all, and it gets a band of its own so it never reads as a job that
// scored badly.
export function scoreBand(total: number | null): string {
  if (total === null) return "score-none";
  if (total >= 90) return "score-good";
  if (total >= 70) return "score-ok";
  return "score-bad";
}

// One category rating into the same class names, on its own one-to-five scale
// rather than the total's. An unjudged category is banded apart for the same
// reason an unscored job is.
export function ratingBand(rating: number | null): string {
  if (rating === null) return "score-none";
  if (rating >= 4) return "score-good";
  if (rating >= 3) return "score-ok";
  return "score-bad";
}

// The five ratings into the one number a narrow screen shows in their place.
// An unjudged category is left out rather than counted as a zero, which would
// drag the average down for a judgement nobody made.
export function averageRating(ratings: (number | null)[]): number | null {
  const valid = ratings.filter((r): r is number => r !== null);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
}
