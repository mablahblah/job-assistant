// Fetches a page and hands back one element's markup. Both page-reading
// collectors work this way: the sites send finished html, so a request and a
// parse do everything a browser would, without starting one.
import { parseHTML } from "linkedom";
import { fetchWithTimeout, httpError } from "./fetch-utils";

// A bare request gets turned away by sites that screen for automated
// traffic, so every request says it is a browser.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// Null means the page loaded but holds no such element — which is how a
// search that matched nothing looks. A refused request throws instead,
// because that is a failure rather than an empty result.
export async function fetchContainer(url: string, selector: string): Promise<string | null> {
  const res = await fetchWithTimeout(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) {
    throw httpError(url, res.status);
  }

  const { document } = parseHTML(await res.text());
  const container = document.querySelector(selector);
  return container === null ? null : container.outerHTML;
}
