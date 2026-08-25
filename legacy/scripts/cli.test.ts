import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseScore } from "./cli";

beforeEach(() => {
  // Make process.exit throw so .toThrow() assertions work.
  // cli.ts's fail() calls process.exit(1); without this mock, Vitest
  // intercepts the exit and throws its own error instead.
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("parseScore", () => {
  it("returns a number for valid scores 1-5", () => {
    expect(parseScore("1", "es")).toBe(1);
    expect(parseScore("3", "wl")).toBe(3);
    expect(parseScore("5", "pa")).toBe(5);
  });

  it("returns null for non-numeric input", () => {
    expect(parseScore("-", "es")).toBeNull();
    expect(parseScore("n/a", "cs")).toBeNull();
    expect(parseScore("", "wl")).toBeNull();
    expect(parseScore("abc", "pa")).toBeNull();
  });

  it("throws for numeric values below 1", () => {
    expect(() => parseScore("0", "es")).toThrow();
  });

  it("throws for numeric values above 5", () => {
    expect(() => parseScore("99", "cs")).toThrow();
  });

  it("throws for negative numbers", () => {
    expect(() => parseScore("-3", "wl")).toThrow();
  });
});
