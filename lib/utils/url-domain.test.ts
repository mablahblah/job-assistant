import { describe, expect, test } from "vitest";
import { extractDomain, isSameDomain } from "./url-domain";

describe("extractDomain: the host is pulled out of a link", () => {
  test("a link with a subdomain gives the whole host", () => {
    expect(extractDomain("https://boards.greenhouse.io/company/jobs/123")).toBe(
      "boards.greenhouse.io",
    );
  });

  test("a link with no subdomain gives the bare host", () => {
    expect(extractDomain("https://lever.co/jobs/456")).toBe("lever.co");
  });
});

describe("extractDomain: a string that is not a link comes back untouched", () => {
  test("a plain word is returned as it was given", () => {
    expect(extractDomain("not-a-url")).toBe("not-a-url");
  });
});

describe("isSameDomain: two links are compared by host alone", () => {
  test("the same host on different paths is the same host", () => {
    expect(
      isSameDomain("https://greenhouse.io/jobs/1", "https://greenhouse.io/apply/1"),
    ).toBe(true);
  });

  test("two different hosts are not the same host", () => {
    expect(
      isSameDomain("https://remotelead.com/jobs/1", "https://boards.greenhouse.io/apply/1"),
    ).toBe(false);
  });
});

describe("isSameDomain: a subdomain counts as a different host", () => {
  test("boards.greenhouse.io is not greenhouse.io", () => {
    expect(
      isSameDomain("https://boards.greenhouse.io/jobs/1", "https://greenhouse.io/jobs/1"),
    ).toBe(false);
  });
});
