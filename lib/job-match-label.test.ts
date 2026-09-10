import { describe, expect, test } from "vitest";
import type { JobListEntry } from "./job-list-entry";
import { matchLabel } from "./job-match-label";

const JAN_01_NOON = new Date("2025-01-01T12:00:00.000Z");
const JAN_02_MORNING = new Date("2025-01-02T09:00:00.000Z");
const JAN_02_NOON = new Date("2025-01-02T12:00:00.000Z");
const JAN_20 = new Date("2025-01-20T00:00:00.000Z");

describe("AC 37: pooled dates under 24 hours apart are a hard match", () => {
  test("21 hours apart is a hard match", () => {
    expect(
      matchLabel({ posting_date: JAN_01_NOON, posting_updated_date: JAN_02_MORNING })
    ).toBe("hard_match_in_list");
  });

  test("a minute apart is a hard match", () => {
    expect(
      matchLabel({
        posting_date: JAN_01_NOON,
        posting_updated_date: new Date("2025-01-01T12:01:00.000Z"),
      })
    ).toBe("hard_match_in_list");
  });
});

describe("AC 38: pooled dates 24 hours or more apart are a repost match", () => {
  test("exactly 24 hours apart is a repost match", () => {
    expect(matchLabel({ posting_date: JAN_01_NOON, posting_updated_date: JAN_02_NOON })).toBe(
      "repost_match_in_list"
    );
  });

  test("19 days apart is a repost match", () => {
    expect(matchLabel({ posting_date: JAN_01_NOON, posting_updated_date: JAN_20 })).toBe(
      "repost_match_in_list"
    );
  });
});

describe("AC 39: one distinct date between two entries is a hard match", () => {
  test("a posted date with no updated date beside it is a hard match", () => {
    expect(matchLabel({ posting_date: JAN_01_NOON, posting_updated_date: null })).toBe(
      "hard_match_in_list"
    );
  });
});

describe("AC 40: no date at all is a hard match", () => {
  test("both dates absent is a hard match", () => {
    expect(matchLabel({})).toBe("hard_match_in_list");
  });

  test("both dates null is a hard match", () => {
    expect(matchLabel({ posting_date: null, posting_updated_date: null })).toBe(
      "hard_match_in_list"
    );
  });
});

describe("AC 41: labelling a match sets no flag and changes no date", () => {
  test("the job it read comes back untouched", () => {
    const merged: JobListEntry = {
      id: "j1",
      title: "Sr. Product Designer",
      posting_date: JAN_01_NOON,
      posting_updated_date: JAN_20,
      is_classified: false,
    };
    const before = { ...merged };

    matchLabel(merged);

    expect(merged).toEqual(before);
    expect(merged.posting_date).toBe(JAN_01_NOON);
    expect(merged.posting_updated_date).toBe(JAN_20);
  });
});
