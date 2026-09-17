import { describe, expect, test } from "vitest";
import { entryTitleFromJob } from "./work-log-title";

// Criterion 80. The tidied title is what every other part of the app shows,
// so an entry naming the published one instead would read as a different job
// from the same job on a page beside it.
describe("a job holding a tidied title", () => {
  test("the entry copies the tidied title", () => {
    expect(entryTitleFromJob({ title: "Senior Designer", raw_title: "Sr. Designer II" })).toBe(
      "Senior Designer"
    );
  });
});

// Criterion 25. Tidying fails on some titles and a job can reach this point
// unparsed, so the published title is what stands in.
describe("a job holding no tidied title", () => {
  test.each([null, undefined, "", "   "])("copies the published title when tidied is %p", (title) => {
    expect(entryTitleFromJob({ title, raw_title: "Sr. Designer II" })).toBe("Sr. Designer II");
  });
});

// Criterion 26. A filing naming a blank job is worse than no filing, so the
// answer is nothing and the caller writes no entry.
describe("a job holding neither title", () => {
  test.each([
    [null, null],
    [undefined, undefined],
    ["", ""],
    ["  ", "  "],
  ])("produces nothing when tidied is %p and published is %p", (title, raw_title) => {
    expect(entryTitleFromJob({ title, raw_title })).toBeUndefined();
  });
});

// A legal filing carries what it is given, so surrounding blanks are taken
// off rather than filed.
describe("a title padded with blanks", () => {
  test("is copied without them", () => {
    expect(entryTitleFromJob({ title: "  Senior Designer  ", raw_title: null })).toBe(
      "Senior Designer"
    );
  });
});
