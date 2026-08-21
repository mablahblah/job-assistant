import { describe, it, expect } from "vitest";
import { hasFieldValue } from "./has-field-value";

describe("hasFieldValue", () => {
  it("treats null as empty", () => {
    expect(hasFieldValue(null)).toBe(false);
  });

  it("treats undefined as empty", () => {
    expect(hasFieldValue(undefined)).toBe(false);
  });

  it("treats the empty string as empty", () => {
    expect(hasFieldValue("")).toBe(false);
  });

  it("treats the unknown-salary sentinel as empty", () => {
    expect(hasFieldValue("?")).toBe(false);
  });

  it("treats a normal value as present", () => {
    expect(hasFieldValue("Austin, TX")).toBe(true);
  });

  it("treats a salary range as present", () => {
    expect(hasFieldValue("$100-$120k")).toBe(true);
  });

  it("treats whitespace as present", () => {
    expect(hasFieldValue(" ")).toBe(true);
  });
});
