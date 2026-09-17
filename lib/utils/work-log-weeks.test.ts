import { describe, expect, test } from "vitest";
import type { WorkLogRow } from "../types/work-log-row";
import { groupByWeek, weekLabel, weekList, weekStart } from "./work-log-weeks";

// Local time throughout, because a benefit week is a run of local days rather
// than a fixed number of hours.
function localDate(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour);
}

function entryWrittenAt(when: Date, id = "entry-1"): WorkLogRow {
  return {
    entry: {
      id,
      job_id: "job-1",
      company_name: "Acme",
      job_title: "Product Designer",
      activity: "Applied for job",
      created_at: when,
    },
    company: null,
  };
}

// The Texas Workforce Commission's benefit week runs Sunday to Saturday, and
// the form is filled in one week at a time, so the week a date falls in is
// what every other function here is built on.
describe("weekStart", () => {
  test("gives the Sunday that opens the week", () => {
    expect(weekStart(localDate(2026, 4, 20))).toEqual(localDate(2026, 4, 19, 0));
  });

  test("a Sunday opens its own week", () => {
    expect(weekStart(localDate(2026, 4, 19))).toEqual(localDate(2026, 4, 19, 0));
  });

  test("a Saturday closes the week that opened six days earlier", () => {
    expect(weekStart(localDate(2026, 4, 11))).toEqual(localDate(2026, 4, 5, 0));
  });

  test("the week starts at midnight, not at the hour it was asked about", () => {
    expect(weekStart(localDate(2026, 4, 20, 23)).getHours()).toBe(0);
  });
});

// Criterion 173. Every week between the first filing and today is listed, so a
// week nothing was filed in still appears and can say it holds nothing.
describe("weekList", () => {
  test("lists every week from the first filing to today, newest first", () => {
    expect(weekList(localDate(2026, 4, 1), localDate(2026, 4, 20))).toEqual([
      localDate(2026, 4, 19, 0),
      localDate(2026, 4, 12, 0),
      localDate(2026, 4, 5, 0),
      localDate(2026, 3, 29, 0),
    ]);
  });

  test("gives one week where the first filing was this week", () => {
    expect(weekList(localDate(2026, 4, 20), localDate(2026, 4, 20))).toEqual([
      localDate(2026, 4, 19, 0),
    ]);
  });
});

// Criterion 163. An entry belongs to the week it was written in, which is the
// week the form it feeds is filed for.
describe("groupByWeek", () => {
  test("puts each entry under the week it was written in", () => {
    const thisWeek = entryWrittenAt(localDate(2026, 4, 20), "entry-1");
    const lastWeek = entryWrittenAt(localDate(2026, 4, 15), "entry-2");
    const grouped = groupByWeek([thisWeek, lastWeek]);

    expect(grouped.get(localDate(2026, 4, 19, 0).toISOString())).toEqual([thisWeek]);
    expect(grouped.get(localDate(2026, 4, 12, 0).toISOString())).toEqual([lastWeek]);
  });

  test("keeps two entries from one week together", () => {
    const first = entryWrittenAt(localDate(2026, 4, 20), "entry-1");
    const second = entryWrittenAt(localDate(2026, 4, 22), "entry-2");
    const grouped = groupByWeek([first, second]);

    expect(grouped.get(localDate(2026, 4, 19, 0).toISOString())).toEqual([first, second]);
  });

  test("holds no week at all where nothing was filed", () => {
    expect(groupByWeek([]).size).toBe(0);
  });
});

// The sidebar and each week's heading both name a week, and the name has to be
// the span of days the form is filed for rather than a single date.
describe("weekLabel", () => {
  test("names the week by the days it opens and closes on", () => {
    expect(weekLabel(localDate(2026, 4, 5, 0))).toBe("Apr 5 – Apr 11, 2026");
  });

  test("carries the year on the closing day", () => {
    expect(weekLabel(localDate(2025, 12, 28, 0))).toBe("Dec 28 – Jan 3, 2026");
  });
});
