import { describe, expect, test } from "vitest";
import { poolJobDates } from "./job-dates";

// Fixed dates with distinct timestamps, so every assertion reads clearly.
const JAN_01 = new Date("2025-01-01T00:00:00.000Z");
const JAN_05 = new Date("2025-01-05T00:00:00.000Z");
const JAN_10 = new Date("2025-01-10T00:00:00.000Z");
const JAN_15 = new Date("2025-01-15T00:00:00.000Z");

// Two sightings hours apart on one calendar day. Repeats match on the exact
// timestamp, so these are two dates rather than one.
const JAN_05_MORNING = new Date("2025-01-05T08:00:00.000Z");
const JAN_05_EVENING = new Date("2025-01-05T20:00:00.000Z");

// Well before every date above, so a pooler reading a clock instead of this
// argument gives itself away.
const COLLECTED_AT = new Date("2024-06-01T00:00:00.000Z");

describe("a side carrying dates against no other side", () => {
  test("one date goes to posting_date and leaves the updated date empty", () => {
    const result = poolJobDates({ posting_date: JAN_05 }, null, COLLECTED_AT);
    expect(result.posting_date).toEqual(JAN_05);
    expect(result.posting_updated_date).toBeNull();
  });

  test("two dates put the earliest first and the latest in the updated date", () => {
    const result = poolJobDates(
      { posting_date: JAN_10, posting_updated_date: JAN_05 },
      null,
      COLLECTED_AT
    );
    expect(result.posting_date).toEqual(JAN_05);
    expect(result.posting_updated_date).toEqual(JAN_10);
  });
});

describe("two sides pooled together", () => {
  test("a newer arriving date becomes the updated date", () => {
    const result = poolJobDates({ posting_date: JAN_10 }, { posting_date: JAN_05 }, COLLECTED_AT);
    expect(result.posting_date).toEqual(JAN_05);
    expect(result.posting_updated_date).toEqual(JAN_10);
  });

  test("an older arriving date takes the posted date and pushes the stored one up", () => {
    const result = poolJobDates({ posting_date: JAN_01 }, { posting_date: JAN_05 }, COLLECTED_AT);
    expect(result.posting_date).toEqual(JAN_01);
    expect(result.posting_updated_date).toEqual(JAN_05);
  });

  test("one older and one newer arriving date bracket the stored one", () => {
    const result = poolJobDates(
      { posting_date: JAN_01, posting_updated_date: JAN_10 },
      { posting_date: JAN_05 },
      COLLECTED_AT
    );
    expect(result.posting_date).toEqual(JAN_01);
    expect(result.posting_updated_date).toEqual(JAN_10);
  });

  test("two arriving dates both newer keep the stored posted date", () => {
    const result = poolJobDates(
      { posting_date: JAN_10, posting_updated_date: JAN_15 },
      { posting_date: JAN_05 },
      COLLECTED_AT
    );
    expect(result.posting_date).toEqual(JAN_05);
    expect(result.posting_updated_date).toEqual(JAN_15);
  });

  test("two arriving dates both older keep the stored updated date", () => {
    const result = poolJobDates(
      { posting_date: JAN_01, posting_updated_date: JAN_05 },
      { posting_date: JAN_10, posting_updated_date: JAN_15 },
      COLLECTED_AT
    );
    expect(result.posting_date).toEqual(JAN_01);
    expect(result.posting_updated_date).toEqual(JAN_15);
  });

  test("two arriving dates both older push the stored posted date to the updated date", () => {
    const result = poolJobDates(
      { posting_date: JAN_01, posting_updated_date: JAN_05 },
      { posting_date: JAN_10 },
      COLLECTED_AT
    );
    expect(result.posting_date).toEqual(JAN_01);
    expect(result.posting_updated_date).toEqual(JAN_10);
  });

  test("a side carrying no dates leaves the other side's dates standing", () => {
    const result = poolJobDates(
      {},
      { posting_date: JAN_05, posting_updated_date: JAN_10 },
      COLLECTED_AT
    );
    expect(result.posting_date).toEqual(JAN_05);
    expect(result.posting_updated_date).toEqual(JAN_10);
  });
});

describe("counting distinct dates", () => {
  test("the same timestamp on both sides counts as one date", () => {
    const result = poolJobDates({ posting_date: JAN_05 }, { posting_date: JAN_05 }, COLLECTED_AT);
    expect(result.posting_date).toEqual(JAN_05);
    expect(result.posting_updated_date).toBeNull();
  });

  test("two times on one calendar day count as two dates", () => {
    const result = poolJobDates(
      { posting_date: JAN_05_EVENING },
      { posting_date: JAN_05_MORNING },
      COLLECTED_AT
    );
    expect(result.posting_date).toEqual(JAN_05_MORNING);
    expect(result.posting_updated_date).toEqual(JAN_05_EVENING);
  });

  test("a null date on a side is not a date", () => {
    const result = poolJobDates(
      { posting_date: JAN_05, posting_updated_date: null },
      null,
      COLLECTED_AT
    );
    expect(result.posting_date).toEqual(JAN_05);
    expect(result.posting_updated_date).toBeNull();
  });
});

describe("no date anywhere", () => {
  test("the posted date falls back to collected_at", () => {
    const result = poolJobDates({}, null, COLLECTED_AT);
    expect(result.posting_date).toEqual(COLLECTED_AT);
    expect(result.posting_updated_date).toBeNull();
  });

  // The fallback date sits well in the past, so a pooler reading a clock of
  // its own would return roughly today and fail here.
  test("the fallback is the argument rather than a clock reading", () => {
    const result = poolJobDates({}, {}, COLLECTED_AT);
    expect(result.posting_date.getTime()).toBe(COLLECTED_AT.getTime());
  });

  test("collected_at is not pooled alongside dates that do exist", () => {
    const result = poolJobDates({ posting_date: JAN_05 }, null, COLLECTED_AT);
    expect(result.posting_updated_date).toBeNull();
  });
});

// Dedupe collapses two job list entries through this same rule, and neither
// may carry a database row.
describe("two job list entries with no stored row", () => {
  test("the rule applies unchanged", () => {
    const result = poolJobDates(
      { posting_date: JAN_10 },
      { posting_date: JAN_01 },
      COLLECTED_AT
    );
    expect(result.posting_date).toEqual(JAN_01);
    expect(result.posting_updated_date).toEqual(JAN_10);
  });
});
