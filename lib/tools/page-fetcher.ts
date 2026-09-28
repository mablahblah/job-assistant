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

// What a page fetch hands back: the answer code and the markup, plus the
// address the answer actually came from, since a redirect can land on a
// different page than the one asked for.
export interface PageAnswer {
  status: number;
  url: string;
  html: string;
}

// Never throws on a non-success answer code. A parser needs to tell a dead
// posting (404, 410) apart from a refusal (403, 429, a server error), and
// that distinction is lost if a bad status throws away the page instead of
// handing it back as data. A network failure or timeout still throws — that
// is fetchWithTimeout's own behaviour, and it is left alone here.
export async function fetchPageAnswer(url: string): Promise<PageAnswer> {
  const res = await fetchWithTimeout(url, { headers: { "user-agent": BROWSER_USER_AGENT } });
  const html = await res.text();

  // A real response's url is the final address after redirects. One that
  // followed no request carries none, so the address asked for stands in.
  return { status: res.status, url: res.url || url, html };
}

// A refused request throws instead of returning, because a refusal is a
// failure, not an empty page.
export async function fetchPageHtml(url: string): Promise<string> {
  const answer = await fetchPageAnswer(url);
  if (answer.status < 200 || answer.status >= 300) {
    throw httpError(url, answer.status);
  }

  return answer.html;
}
