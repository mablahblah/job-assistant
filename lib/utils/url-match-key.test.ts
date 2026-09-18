import { describe, expect, test } from "vitest";
import { urlMatchKey } from "./url-match-key";

describe("AC 6: a link's whole query string is dropped", () => {
  test("everything after the question mark goes", () => {
    expect(urlMatchKey("https://example.com/jobs/123?se=abc&utm_source=api")).toBe(
      "https://example.com/jobs/123"
    );
  });

  test("a question mark with nothing after it goes too", () => {
    expect(urlMatchKey("https://example.com/jobs/123?")).toBe("https://example.com/jobs/123");
  });
});

describe("AC 7: a link's fragment is dropped", () => {
  test("everything after the hash goes", () => {
    expect(urlMatchKey("https://example.com/jobs/123#apply")).toBe("https://example.com/jobs/123");
  });

  test("a query and a fragment together both go", () => {
    expect(urlMatchKey("https://example.com/jobs/123?se=abc#apply")).toBe(
      "https://example.com/jobs/123"
    );
  });
});

describe("AC 8: a link's host is lowercased", () => {
  test("a host written in mixed case comes out lowercase", () => {
    expect(urlMatchKey("https://WWW.Example.COM/jobs/123")).toBe("https://www.example.com/jobs/123");
  });

  test("the path keeps the case the source wrote", () => {
    // Only the host is lowercased. A posting id in the path can be
    // case-sensitive, so flattening it would key two different jobs the same.
    expect(urlMatchKey("https://example.com/Jobs/AbC123")).toBe("https://example.com/Jobs/AbC123");
  });
});

describe("AC 9: a trailing slash on the path is dropped", () => {
  test("a path ending in a slash loses it", () => {
    expect(urlMatchKey("https://example.com/jobs/123/")).toBe("https://example.com/jobs/123");
  });

  test("the same posting with and without the trailing slash keys the same", () => {
    expect(urlMatchKey("https://example.com/jobs/123/")).toBe(
      urlMatchKey("https://example.com/jobs/123")
    );
  });
});

describe("AC 10: a link with no path keys to the scheme and host alone", () => {
  test("a bare host keeps no path", () => {
    // The URL parser reads a bare host as a path of "/", and the
    // trailing-slash drop takes that slash with it.
    expect(urlMatchKey("https://example.com")).toBe("https://example.com");
  });

  test("a bare host written with its root slash keys the same", () => {
    expect(urlMatchKey("https://example.com/")).toBe("https://example.com");
  });
});

describe("AC 11: two Adzuna links for one posting differing only in `se` key the same", () => {
  test("the session parameter does not split one posting into two", () => {
    // Adzuna hands back a fresh `se` value on every search, so the same
    // posting arrives under a different link each run.
    const first = "https://www.adzuna.com/land/ad/5872600391?se=8lLTgnii8BroTBApR2iJSA";
    const second = "https://www.adzuna.com/land/ad/5872600391?se=qZ4xvNmT2RaLcP9wKdEuHg";

    expect(urlMatchKey(first)).toBe(urlMatchKey(second));
    expect(urlMatchKey(first)).toBe("https://www.adzuna.com/land/ad/5872600391");
  });
});

describe("AC 12: one link read twice keys identically", () => {
  test("the same link in, the same key out", () => {
    const link = "https://example.com/jobs/123?se=abc#apply";

    expect(urlMatchKey(link)).toBe(urlMatchKey(link));
  });
});

describe("AC 13: a string that is not a URL returns nothing rather than throwing", () => {
  test("plain words return null", () => {
    expect(urlMatchKey("not a url")).toBeNull();
  });

  test("an empty string returns null", () => {
    expect(urlMatchKey("")).toBeNull();
  });

  test("a host with no scheme returns null", () => {
    expect(urlMatchKey("example.com/jobs/123")).toBeNull();
  });
});

describe("AC 14: the link handed in is never altered", () => {
  test("the caller's link still reads as it did after a key is built", () => {
    // The published link has to keep working. Measured, an Adzuna link
    // answers 200 with its query and 400 without, so the key can never
    // stand in for the link itself.
    const link = "https://www.adzuna.com/land/ad/5872600391?se=8lLTgnii8BroTBApR2iJSA";

    urlMatchKey(link);

    expect(link).toBe("https://www.adzuna.com/land/ad/5872600391?se=8lLTgnii8BroTBApR2iJSA");
  });
});
