import { afterEach, describe, expect, test } from "vitest";
import { fetchWithTimeout, safeJson, httpError } from "./fetch-utils";

// Each test below swaps the global fetch for a plain stand-in and the real one
// is put back afterwards, so nothing leaks into the next test.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchWithTimeout", () => {
  test("returns the response the underlying fetch resolved with", async () => {
    const stubResponse = new Response("ok");
    globalThis.fetch = async () => stubResponse;

    const result = await fetchWithTimeout("https://example.com");

    expect(result).toBe(stubResponse);
  });

  test("passes the url through to fetch unchanged", async () => {
    let receivedUrl: unknown;
    globalThis.fetch = async (url) => {
      receivedUrl = url;
      return new Response("ok");
    };

    await fetchWithTimeout("https://example.com/jobs");

    expect(receivedUrl).toBe("https://example.com/jobs");
  });

  test("passes caller options such as headers through to fetch", async () => {
    let receivedOptions: RequestInit | undefined;
    globalThis.fetch = async (_url, options) => {
      receivedOptions = options;
      return new Response("ok");
    };

    await fetchWithTimeout("https://example.com", { headers: { "X-Test": "1" } });

    expect(receivedOptions?.headers).toEqual({ "X-Test": "1" });
  });

  test("does not pass timeoutMs on to fetch", async () => {
    // timeoutMs is this function's own option, not one fetch understands.
    let receivedOptions: RequestInit | undefined;
    globalThis.fetch = async (_url, options) => {
      receivedOptions = options;
      return new Response("ok");
    };

    await fetchWithTimeout("https://example.com", { timeoutMs: 5000 });

    expect(receivedOptions).not.toHaveProperty("timeoutMs");
  });

  test("supplies an AbortSignal to fetch", async () => {
    let receivedOptions: RequestInit | undefined;
    globalThis.fetch = async (_url, options) => {
      receivedOptions = options;
      return new Response("ok");
    };

    await fetchWithTimeout("https://example.com");

    expect(receivedOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  test("an aborted request becomes an error naming the timeout", async () => {
    // Standing in for a fetch that never settles. Rather than waiting out a
    // real timer, the stand-in rejects with the error an abort produces.
    globalThis.fetch = async () => {
      throw new DOMException("aborted", "AbortError");
    };

    await expect(fetchWithTimeout("https://example.com")).rejects.toThrow(/timeout/i);
  });

  test("the timeout error names the number of seconds waited", async () => {
    globalThis.fetch = async () => {
      throw new DOMException("aborted", "AbortError");
    };

    await expect(
      fetchWithTimeout("https://example.com", { timeoutMs: 5000 })
    ).rejects.toThrow("5");
  });

  test("an error that is neither an abort is passed through as-is", async () => {
    // The real message says more about what went wrong than any rewrite of it.
    const original = new Error("boom");
    globalThis.fetch = async () => {
      throw original;
    };

    await expect(fetchWithTimeout("https://example.com")).rejects.toBe(original);
  });
});

describe("safeJson", () => {
  test("returns the parsed body when the response parses", async () => {
    const res = new Response(JSON.stringify({ title: "Designer" }));

    await expect(safeJson<{ title: string }>(res, "greenhouse")).resolves.toEqual({
      title: "Designer",
    });
  });

  test("a response whose json rejects becomes an error naming the label", async () => {
    const res = new Response("not json");

    await expect(safeJson(res, "greenhouse")).rejects.toThrow(/greenhouse/);
  });

  test("a response whose json rejects becomes an error saying the JSON was invalid", async () => {
    const res = new Response("not json");

    await expect(safeJson(res, "greenhouse")).rejects.toThrow(/invalid/i);
  });
});

describe("httpError", () => {
  test("429 gives a rate-limit message", () => {
    const error = httpError("greenhouse", 429);
    expect(error.message).toContain("greenhouse");
    expect(error.message).toContain("429");
  });

  test("401 gives an unauthorized message", () => {
    const error = httpError("greenhouse", 401);
    expect(error.message).toContain("greenhouse");
    expect(error.message).toContain("401");
  });

  test("403 gives an unauthorized message", () => {
    const error = httpError("greenhouse", 403);
    expect(error.message).toContain("greenhouse");
    expect(error.message).toContain("403");
  });

  test("a 500-or-above status gives a server-error message", () => {
    const error = httpError("greenhouse", 503);
    expect(error.message).toContain("greenhouse");
    expect(error.message).toContain("503");
  });

  test("a status outside the named cases gives a message with that status", () => {
    const error = httpError("greenhouse", 418);
    expect(error.message).toContain("greenhouse");
    expect(error.message).toContain("418");
  });

  test("returns an Error rather than throwing it", () => {
    expect(httpError("greenhouse", 404)).toBeInstanceOf(Error);
  });
});
