// Pure utility functions for the web view — no side effects, no DB access

// Returns CSS class for composite score color coding
// Green >= 90, orange >= 70, red < 70, grey for null
export function scoreColor(score: number | null): string {
  if (score === null) return "score-none";
  if (score >= 90) return "score-good";
  if (score >= 70) return "score-ok";
  return "score-bad";
}

// Returns CSS class for individual 1–5 category rating
// Green >= 4, orange >= 3, red < 3, grey for null
export function ratingColor(rating: number | null): string {
  if (rating === null) return "score-none";
  if (rating >= 4) return "score-good";
  if (rating >= 3) return "score-ok";
  return "score-bad";
}

// Returns human-readable relative date like "Today", "1d ago", "5d ago"
export function relativeDate(date: Date, now: Date = new Date()): string {
  const days = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days === 0) return "Today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

// Returns average of non-null scores rounded to 1 decimal, or null if all null
// Used for the mobile rollup column that replaces 5 individual score columns
export function avgRating(scores: (number | null)[]): number | null {
  const valid = scores.filter((s): s is number => s !== null);
  if (valid.length === 0) return null;
  return (
    Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10
  );
}

// Escapes HTML special characters to prevent injection
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
