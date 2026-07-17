import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the withBrowser helper from fetch-utils
vi.mock("@/lib/scrapers/fetch-utils", () => ({
  withBrowser: vi.fn(),
}));

import { withBrowser } from "@/lib/scrapers/fetch-utils";
import { fetchPage } from "./fetch-page";

const mockWithBrowser = withBrowser as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchPage", () => {
  it("returns the rendered HTML content of a page", async () => {
    mockWithBrowser.mockImplementation(async (fn: (page: unknown) => Promise<unknown>) => {
      // Simulate the page object that withBrowser provides
      const fakePage = {
        goto: vi.fn(),
        content: vi.fn().mockResolvedValue("<html><body>Hello</body></html>"),
      };
      return fn(fakePage);
    });

    const html = await fetchPage("https://example.com/job/1");

    expect(html).toBe("<html><body>Hello</body></html>");
  });

  it("navigates to the provided URL with networkidle wait", async () => {
    let capturedUrl = "";
    let capturedOptions = {};

    mockWithBrowser.mockImplementation(async (fn: (page: unknown) => Promise<unknown>) => {
      const fakePage = {
        goto: vi.fn().mockImplementation((url: string, opts: unknown) => {
          capturedUrl = url;
          capturedOptions = opts as Record<string, unknown>;
        }),
        content: vi.fn().mockResolvedValue("<html></html>"),
      };
      return fn(fakePage);
    });

    await fetchPage("https://example.com/job/1");

    expect(capturedUrl).toBe("https://example.com/job/1");
    expect(capturedOptions).toEqual({ waitUntil: "networkidle", timeout: 30000 });
  });

  it("propagates errors from withBrowser", async () => {
    mockWithBrowser.mockRejectedValue(new Error("Browser failed to launch — is Playwright installed? (npx playwright install chromium)"));

    await expect(fetchPage("https://example.com")).rejects.toThrow("Browser failed to launch");
  });
});
