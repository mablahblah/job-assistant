import { describe, expect, test } from "vitest";
import { relativeDate } from "./relative-date";

// Criterion 123. Every row shows when its job was posted, and a posting's age
// is what the user is judging, so the row says how long ago rather than giving
// a calendar date to subtract from today.
describe("relativeDate", () => {
  const now = new Date("2026-04-20T12:00:00Z");

  test("says today where less than a day has passed", () => {
    expect(relativeDate(new Date("2026-04-20T06:00:00Z"), now)).toBe("Today");
  });

  test("says one day where a day has passed", () => {
    expect(relativeDate(new Date("2026-04-19T12:00:00Z"), now)).toBe("1d ago");
  });

  test("counts the whole days that have passed", () => {
    expect(relativeDate(new Date("2026-04-15T12:00:00Z"), now)).toBe("5d ago");
  });

  // A part day is not rounded up. A posting from thirty hours ago is one day
  // old, not two.
  test("ignores the part day left over", () => {
    expect(relativeDate(new Date("2026-04-19T06:00:00Z"), now)).toBe("1d ago");
  });
});
