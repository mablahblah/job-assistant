import { describe, it, expect } from "vitest";
import { parseAgeToDays, isStale, ageToDate } from "./parse-age";

describe("parseAgeToDays", () => {
  it("parses hours as 0 days", () => {
    expect(parseAgeToDays("6h")).toBe(0);
    expect(parseAgeToDays("17 hours ago")).toBe(0);
    expect(parseAgeToDays("Posted about 2 hours ago")).toBe(0);
  });

  it("parses minutes as 0 days", () => {
    expect(parseAgeToDays("7 minutes ago")).toBe(0);
    expect(parseAgeToDays("just now")).toBe(0);
  });

  it("parses days", () => {
    expect(parseAgeToDays("1d")).toBe(1);
    expect(parseAgeToDays("3 days ago")).toBe(3);
    expect(parseAgeToDays("Posted 1 day ago")).toBe(1);
  });

  it("parses yesterday as 1 day", () => {
    expect(parseAgeToDays("yesterday")).toBe(1);
  });

  it("parses 'last week' as 7 days", () => {
    expect(parseAgeToDays("last week")).toBe(7);
  });

  it("parses weeks", () => {
    expect(parseAgeToDays("2 weeks ago")).toBe(14);
    expect(parseAgeToDays("1w")).toBe(7);
  });

  it("parses months", () => {
    expect(parseAgeToDays("1mo")).toBe(30);
    expect(parseAgeToDays("2 months ago")).toBe(60);
    expect(parseAgeToDays("last month")).toBe(30);
  });

  it("parses years", () => {
    expect(parseAgeToDays("1y")).toBe(365);
    expect(parseAgeToDays("2 years ago")).toBe(730);
  });

  it("returns null for unrecognized strings", () => {
    expect(parseAgeToDays("")).toBeNull();
    expect(parseAgeToDays("Apply now")).toBeNull();
  });
});

describe("isStale", () => {
  it("returns false for ages under 8 days", () => {
    expect(isStale("6h")).toBe(false);
    expect(isStale("3 days ago")).toBe(false);
    expect(isStale("1w")).toBe(false); // 7 days — just under the threshold
  });

  it("returns true for ages 8+ days", () => {
    expect(isStale("8d")).toBe(true);
    expect(isStale("2 weeks ago")).toBe(true); // 14 days
    expect(isStale("1mo")).toBe(true); // 30 days
  });

  it("returns false for unrecognized strings", () => {
    // parseAgeToDays returns null, so isStale should not treat it as stale
    expect(isStale("Apply now")).toBe(false);
    expect(isStale("")).toBe(false);
  });
});

describe("ageToDate", () => {
  it("returns approximate date for '3 days ago'", () => {
    const now = new Date("2026-06-12T12:00:00Z");
    const result = ageToDate("3 days ago", now);
    // 3 days ago from noon June 12 = June 9
    expect(result).not.toBeNull();
    expect(result!.toISOString().slice(0, 10)).toBe("2026-06-09");
  });

  it("returns today's date for 'just now'", () => {
    const now = new Date("2026-06-12T12:00:00Z");
    const result = ageToDate("just now", now);
    expect(result).not.toBeNull();
    expect(result!.toISOString().slice(0, 10)).toBe("2026-06-12");
  });

  it("returns null for unparseable string", () => {
    const now = new Date("2026-06-12T12:00:00Z");
    expect(ageToDate("not a date", now)).toBeNull();
  });

  it("defaults to Date.now() when no reference date provided", () => {
    const before = Date.now();
    const result = ageToDate("0 days ago");
    const after = Date.now();
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThanOrEqual(before - 86400000);
    expect(result!.getTime()).toBeLessThanOrEqual(after);
  });
});
