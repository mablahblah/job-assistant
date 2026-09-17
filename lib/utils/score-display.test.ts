import { describe, expect, test } from "vitest";
import { averageRating, ratingBand, scoreBand } from "./score-display";

// Criterion 118. A total is one number on the row, and the band is what turns
// it into a colour the stylesheet already defines. The thresholds are the ones
// the old dashboard used, because this phase changes nothing about how the page
// looks.
describe("scoreBand", () => {
  test.each([90, 100, 150])("%d is a good total", (total) => {
    expect(scoreBand(total)).toBe("score-good");
  });

  test.each([70, 89])("%d is a fair total", (total) => {
    expect(scoreBand(total)).toBe("score-ok");
  });

  test.each([69, 0])("%d is a poor total", (total) => {
    expect(scoreBand(total)).toBe("score-bad");
  });

  // A job or employer that has never been scored has no total, and an unscored
  // job must not read as a badly scoring one.
  test("an absent total has its own band", () => {
    expect(scoreBand(null)).toBe("score-none");
  });
});

// Criterion 143. A rating runs one to five, so it is banded on its own scale
// rather than on the total's.
describe("ratingBand", () => {
  test.each([4, 5])("%d is a good rating", (rating) => {
    expect(ratingBand(rating)).toBe("score-good");
  });

  test("3 is a fair rating", () => {
    expect(ratingBand(3)).toBe("score-ok");
  });

  test.each([2, 1])("%d is a poor rating", (rating) => {
    expect(ratingBand(rating)).toBe("score-bad");
  });

  test("an absent rating has its own band", () => {
    expect(ratingBand(null)).toBe("score-none");
  });
});

// Criterion 143. The narrow screen rolls the five rating columns into one, and
// that one column shows their average.
describe("averageRating", () => {
  test("averages the ratings it was given", () => {
    expect(averageRating([4, 3, 5, 4, 4])).toBe(4);
  });

  // An unscored category is left out of the average rather than counted as a
  // zero, which would drag the average down for a category nobody judged.
  test("leaves an absent rating out of the average", () => {
    expect(averageRating([4, null, 5, null, 3])).toBe(4);
  });

  test("gives no average where every rating is absent", () => {
    expect(averageRating([null, null, null, null, null])).toBeNull();
  });

  test("rounds the average to one decimal place", () => {
    expect(averageRating([4, 3, 5, 4, 2])).toBe(3.6);
  });
});
