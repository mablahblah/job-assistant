import { describe, expect, test } from "vitest";
import { MAX_DETAIL_LENGTH, truncateDetail } from "./trace-detail";

describe("the length a trace detail is cut at", () => {
  test("is 200 characters", () => {
    expect(MAX_DETAIL_LENGTH).toBe(200);
  });
});

describe("cutting a value down to fit a trace detail", () => {
  test("leaves a value shorter than the limit alone", () => {
    expect(truncateDetail("Senior Product Designer")).toBe("Senior Product Designer");
  });

  test("leaves a value exactly at the limit alone", () => {
    const exact = "x".repeat(MAX_DETAIL_LENGTH);

    expect(truncateDetail(exact)).toBe(exact);
  });

  test("cuts a longer value to the limit", () => {
    const long = "x".repeat(MAX_DETAIL_LENGTH + 1);

    expect(truncateDetail(long)).toHaveLength(MAX_DETAIL_LENGTH);
  });

  test("keeps the front of what it cuts, so the value is still recognizable", () => {
    const long = `Staff Product Designer${"x".repeat(MAX_DETAIL_LENGTH)}`;

    expect(truncateDetail(long).startsWith("Staff Product Designer")).toBe(true);
  });

  test("leaves an empty value alone", () => {
    expect(truncateDetail("")).toBe("");
  });
});
