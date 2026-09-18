// A stand-in holding finished pages by url. For any other url it fails the
// way the real tool fails on a page that never settles, so a test can
// exercise the failure branch without a browser.
import type { RenderedPageFetcher } from "./rendered-page-fetcher";

export function fakeRenderedPageFetcher(pages: Record<string, string>): RenderedPageFetcher {
  return {
    async fetch(url: string): Promise<string> {
      const page = pages[url];
      if (page === undefined) {
        throw new Error(`No page stored for ${url}`);
      }
      return page;
    },
  };
}
