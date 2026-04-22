import { describe, it, expect } from "vitest";
import {
  scoreColor,
  ratingColor,
  relativeDate,
  avgRating,
  escapeHtml,
} from "./helpers";

describe("scoreColor", () => {
  it("returns score-good for scores >= 90", () => {
    expect(scoreColor(90)).toBe("score-good");
    expect(scoreColor(100)).toBe("score-good");
    expect(scoreColor(150)).toBe("score-good");
  });

  it("returns score-ok for scores >= 70 and < 90", () => {
    expect(scoreColor(70)).toBe("score-ok");
    expect(scoreColor(89)).toBe("score-ok");
  });

  it("returns score-bad for scores < 70", () => {
    expect(scoreColor(69)).toBe("score-bad");
    expect(scoreColor(0)).toBe("score-bad");
  });

  it("returns score-none for null", () => {
    expect(scoreColor(null)).toBe("score-none");
  });
});

describe("ratingColor", () => {
  it("returns score-good for ratings >= 4", () => {
    expect(ratingColor(4)).toBe("score-good");
    expect(ratingColor(5)).toBe("score-good");
  });

  it("returns score-ok for ratings >= 3 and < 4", () => {
    expect(ratingColor(3)).toBe("score-ok");
  });

  it("returns score-bad for ratings < 3", () => {
    expect(ratingColor(2)).toBe("score-bad");
    expect(ratingColor(1)).toBe("score-bad");
  });

  it("returns score-none for null", () => {
    expect(ratingColor(null)).toBe("score-none");
  });
});

describe("relativeDate", () => {
  const now = new Date("2026-04-20T12:00:00Z");

  it('returns "Today" for same-day dates', () => {
    const date = new Date("2026-04-20T06:00:00Z");
    expect(relativeDate(date, now)).toBe("Today");
  });

  it('returns "1d ago" for 1-day-old dates', () => {
    const date = new Date("2026-04-19T12:00:00Z");
    expect(relativeDate(date, now)).toBe("1d ago");
  });

  it("returns Nd ago for older dates", () => {
    const date = new Date("2026-04-15T12:00:00Z");
    expect(relativeDate(date, now)).toBe("5d ago");
  });
});

describe("avgRating", () => {
  it("returns average of all non-null scores", () => {
    expect(avgRating([4, 3, 5, 4, 4])).toBe(4);
  });

  it("skips null values in the average", () => {
    expect(avgRating([4, null, 5, null, 3])).toBe(4);
  });

  it("returns null when all scores are null", () => {
    expect(avgRating([null, null, null, null, null])).toBeNull();
  });

  it("rounds to one decimal place", () => {
    expect(avgRating([4, 3, 5, 4, 2])).toBe(3.6);
  });
});

describe("escapeHtml", () => {
  it("escapes angle brackets and ampersands", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;",
    );
  });

  it("escapes quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  it("returns empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });
});
