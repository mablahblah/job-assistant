// Fetches a page's raw markup, nothing more. Splitting this out of
// fetchContainer means every caller — the old element-picking collectors and
// the new job-posting parsers alike — sends the same browser user agent,
// instead of parsers falling back on fetchWithTimeout, which sets no headers
// and would get turned away.
import { fetchWithTimeout, httpError } from "../utils/fetch-utils";

// A bare request gets turned away by sites that screen for automated
// traffic, so every request says it is a browser.
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// A refused request throws instead of returning, because a refusal is a
// failure, not an empty page.
export async function fetchPageHtml(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, { headers: { "user-agent": BROWSER_USER_AGENT } });
  if (!res.ok) {
    throw httpError(url, res.status);
  }

  return res.text();
}
