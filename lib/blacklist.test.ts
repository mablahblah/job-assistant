import { describe, expect, test } from "vitest";
import { BLACKLISTED_DOMAINS, isBlacklistedUrl } from "./blacklist";

describe("the list holds bare hostnames", () => {
  test("it is not empty", () => {
    expect(BLACKLISTED_DOMAINS.length).toBeGreaterThan(0);
  });

  test("no entry carries a scheme or a path", () => {
    for (const domain of BLACKLISTED_DOMAINS) {
      expect(domain).not.toContain("://");
      expect(domain).not.toContain("/");
    }
  });
});

describe("AC 12: a URL on a blacklisted host is recognised", () => {
  test("the host matches a listed domain exactly", () => {
    expect(isBlacklistedUrl("https://jobleads.com/job/123")).toBe(true);
  });
});

describe("AC 13: a URL on a subdomain of a blacklisted host is recognised", () => {
  test("a www prefix is still the blacklisted host", () => {
    expect(isBlacklistedUrl("https://www.jobleads.com/job/123")).toBe(true);
  });

  test("a deeper subdomain is still the blacklisted host", () => {
    expect(isBlacklistedUrl("https://jobs.uk.jobleads.com/job/123")).toBe(true);
  });
});

describe("AC 14: a URL on no blacklisted host is not recognised", () => {
  test("a host nowhere on the list passes", () => {
    expect(isBlacklistedUrl("https://greenhouse.io/job/456")).toBe(false);
  });

  test("a host that merely ends with a listed domain's letters passes", () => {
    expect(isBlacklistedUrl("https://notjobleads.com/job/1")).toBe(false);
  });
});

describe("AC 15: a string that is not a URL is not recognised, and nothing throws", () => {
  test("a plain word passes", () => {
    expect(isBlacklistedUrl("not-a-url")).toBe(false);
  });

  test("an empty string passes", () => {
    expect(isBlacklistedUrl("")).toBe(false);
  });
});
