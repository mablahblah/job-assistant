import { describe, expect, test } from "vitest";
import { placeFromParts } from "./place-from-parts";

describe("placeFromParts", () => {
  test("the parts are joined in order, with a comma between each", () => {
    expect(placeFromParts(["New York", "New York", "United States"])).toBe(
      "New York, New York, United States"
    );
  });

  test("a missing or blank part is dropped", () => {
    expect(placeFromParts(["Athens", null, "  ", undefined, "Greece"])).toBe("Athens, Greece");
  });

  test("no part naming anything gives no place at all", () => {
    expect(placeFromParts([null, "", undefined])).toBeUndefined();
  });
});
