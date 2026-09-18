import { describe, expect, test } from "vitest";
import { fakeRenderedPageFetcher } from "./rendered-page-fetcher.fake";

describe("the stand-in fetcher", () => {
  test("hands back the page stored for a url", async () => {
    const fetcher = fakeRenderedPageFetcher({
      "https://example.com/job": "<html><body>rendered posting</body></html>",
    });

    await expect(fetcher.fetch("https://example.com/job")).resolves.toContain(
      "rendered posting"
    );
  });

  // The real tool throws when a page never settles, so the stand-in fails
  // the same way for a url it holds nothing for — a test exercising the
  // failure branch needs no real browser.
  test("throws for a url it holds no page for", async () => {
    const fetcher = fakeRenderedPageFetcher({});

    await expect(fetcher.fetch("https://example.com/missing")).rejects.toThrow(
      "https://example.com/missing"
    );
  });
});
