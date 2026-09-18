// Fetches a page and hands back one element's markup. Both page-reading
// collectors work this way: the sites send finished html, so a request and a
// parse do everything a browser would, without starting one.
//
// The fetching half is the page-fetcher tool, shared with the parsers, so
// every request out of this codebase carries the same browser user agent.
import { parseHTML } from "linkedom";
import { fetchPageHtml } from "../tools/page-fetcher";

// Null means the page loaded but holds no such element — which is how a
// search that matched nothing looks. A refused request throws instead,
// because that is a failure rather than an empty result, and the tool is
// what raises it.
export async function fetchContainer(url: string, selector: string): Promise<string | null> {
  const { document } = parseHTML(await fetchPageHtml(url));
  const container = document.querySelector(selector);
  return container === null ? null : container.outerHTML;
}
