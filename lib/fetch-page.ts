import { withBrowser } from "@/lib/scrapers/fetch-utils";

// Fetches the fully-rendered HTML of a URL via headless Chromium.
// Uses networkidle to wait for JS-rendered content to finish loading.
export async function fetchPage(url: string): Promise<string> {
  return withBrowser(async (page) => {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    return page.content();
  });
}
