import { describe, it, expect } from "vitest";
import { BLACKLISTED_DOMAINS, isBlacklistedUrl } from "./blacklist";

describe("BLACKLISTED_DOMAINS", () => {
  it("exports a non-empty array of bare domain strings", () => {
    expect(Array.isArray(BLACKLISTED_DOMAINS)).toBe(true);
    expect(BLACKLISTED_DOMAINS.length).toBeGreaterThan(0);
    for (const d of BLACKLISTED_DOMAINS) {
      expect(d).not.toContain("://");
      expect(d).not.toContain("/");
    }
  });
});

describe("isBlacklistedUrl", () => {
  it("blocks an exact domain match", () => {
    expect(isBlacklistedUrl("https://jobleads.com/job/123")).toBe(true);
  });

  it("blocks a subdomain match (www prefix)", () => {
    expect(isBlacklistedUrl("https://www.jobleads.com/job/123")).toBe(true);
  });

  it("blocks a deeper subdomain match", () => {
    expect(isBlacklistedUrl("https://jobs.uk.jobleads.com/job/123")).toBe(true);
  });

  it("allows a domain not in the list", () => {
    expect(isBlacklistedUrl("https://greenhouse.io/job/456")).toBe(false);
  });

  it("does not false-positive on partial domain overlap", () => {
    expect(isBlacklistedUrl("https://notjobleads.com/job/1")).toBe(false);
  });

  it("returns false for malformed URLs", () => {
    expect(isBlacklistedUrl("not-a-url")).toBe(false);
    expect(isBlacklistedUrl("")).toBe(false);
  });
});
