import { describe, expect, test } from "vitest";
import { shortReply } from "./short-reply";

describe("shortReply", () => {
  test("a reply of 300 characters or fewer is kept whole", () => {
    expect(shortReply("y".repeat(300))).toBe("y".repeat(300));
  });

  test("a longer reply keeps its first 300 characters, followed by an ellipsis", () => {
    expect(shortReply("y".repeat(301))).toBe(`${"y".repeat(300)}…`);
  });

  test("surrounding whitespace is trimmed before counting", () => {
    expect(shortReply(`  ${"y".repeat(300)}\n`)).toBe("y".repeat(300));
  });
});
