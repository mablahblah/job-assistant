import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchContainer } from "./fetch-page";

// Every test drives a stubbed global fetch, so the suite never reaches a
// job site.
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

const PAGE = `<html><body>
  <ol class="job-board-job-list"><li class="job-list-item">a job</li></ol>
</body></html>`;

describe("the element's html comes back", () => {
  test("the container's own markup is returned, not the whole page", async () => {
    stubFetch(PAGE);

    const html = await fetchContainer("https://example.com/jobs", "ol.job-board-job-list");

    expect(html).toContain("job-list-item");
    expect(html).not.toContain("<body>");
  });

  test("the url asked for is the url fetched", async () => {
    const stub = stubFetch(PAGE);

    await fetchContainer("https://example.com/jobs", "ol.job-board-job-list");

    expect(stub.mock.calls[0][0]).toBe("https://example.com/jobs");
  });

  test("a browser user agent is sent, since a bare one gets turned away", async () => {
    const stub = stubFetch(PAGE);

    await fetchContainer("https://example.com/jobs", "ol.job-board-job-list");

    const options = stub.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(options.headers?.["user-agent"]).toMatch(/Mozilla/);
  });
});

describe("a page with no such element", () => {
  test("returns null rather than throwing", async () => {
    stubFetch("<html><body><p>no jobs here</p></body></html>");

    const html = await fetchContainer("https://example.com/jobs", "ol.job-board-job-list");

    expect(html).toBeNull();
  });

  test("an empty body returns null too", async () => {
    stubFetch("");

    const html = await fetchContainer("https://example.com/jobs", "ol.job-board-job-list");

    expect(html).toBeNull();
  });
});

describe("a refused request", () => {
  test("throws an error naming the status", async () => {
    stubFetch("nope", 503);

    await expect(fetchContainer("https://example.com/jobs", "ol.x")).rejects.toThrow(/503/);
  });

  test("throws rather than answering null, since a refusal is not an empty page", async () => {
    stubFetch("nope", 404);

    await expect(fetchContainer("https://example.com/jobs", "ol.x")).rejects.toThrow();
  });
});
