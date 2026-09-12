import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchPageHtml } from "./page-fetcher";

// Every test drives a stubbed global fetch, so the suite never reaches a
// real site.
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

// Answers every request with this body and status.
function stubFetch(body: string, status = 200): ReturnType<typeof vi.fn> {
  const stub = vi.fn(async () => new Response(body, { status }));
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
  return stub;
}

describe("fetchPageHtml: the page's own markup comes back", () => {
  test("the body of the answer is returned whole", async () => {
    stubFetch("<html><body><p>a job</p></body></html>");

    await expect(fetchPageHtml("https://example.com/jobs/1")).resolves.toBe(
      "<html><body><p>a job</p></body></html>",
    );
  });

  test("the url asked for is the url fetched", async () => {
    const stub = stubFetch("<html></html>");

    await fetchPageHtml("https://example.com/jobs/1");

    expect(stub.mock.calls[0][0]).toBe("https://example.com/jobs/1");
  });
});

describe("fetchPageHtml: every request says it is a browser", () => {
  test("a browser user agent is sent, since a bare request gets turned away", async () => {
    const stub = stubFetch("<html></html>");

    await fetchPageHtml("https://example.com/jobs/1");

    const options = stub.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(options.headers?.["user-agent"]).toMatch(/Mozilla/);
  });
});

describe("fetchPageHtml: a refused request throws rather than answering", () => {
  test("a server error throws an error naming the status", async () => {
    stubFetch("nope", 503);

    await expect(fetchPageHtml("https://example.com/jobs/1")).rejects.toThrow(/503/);
  });

  test("a missing page throws rather than answering an empty page", async () => {
    stubFetch("nope", 404);

    await expect(fetchPageHtml("https://example.com/jobs/1")).rejects.toThrow(/404/);
  });
});
