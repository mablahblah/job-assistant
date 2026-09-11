// A stand-in for a real browser page, used to test the URL resolver's hop
// loop without a browser. A test lays out the whole walk up front as an
// ordered list of pages; each call to goto ignores the URL it is handed and
// simply serves the next page in that list. This lets a test say "start
// here, land there, then dead-end" without modelling a URL-to-page lookup.
import { parseHTML } from "linkedom";
import type { PageAnchor, ResolutionPage, ResolutionResponse } from "./resolution-page";

export interface ScriptedPage {
  // The address the page settles on — what url() reports once this hop is done.
  url: string;
  // The responses this hop produced, in the order they arrived. The first is
  // what goto hands back; the last is the page actually landed on. Defaults to
  // a single 200 at `url`.
  responses?: { url: string; status: number }[];
  // The page's HTML. Defaults to an empty string.
  html?: string;
  // The page's title. Defaults to an empty string.
  title?: string;
  // When true, goto rejects — the browser could not load this hop at all.
  failsToLoad?: boolean;
}

// Wraps one scripted { url, status } pair as the ResolutionResponse shape
// the walk expects.
function toResolutionResponse(response: {
  url: string;
  status: number;
}): ResolutionResponse {
  return {
    status: () => response.status,
    url: () => response.url,
  };
}

export function fakeResolutionPage(script: ScriptedPage[]): ResolutionPage {
  // Which scripted page goto is up to. The first goto serves script[0].
  let nextIndex = 0;
  // The page the walk last landed on. Undefined until the first goto.
  let currentPage: ScriptedPage | undefined;
  // Everyone listening for "response" events, in registration order.
  let handlers: ((response: ResolutionResponse) => void)[] = [];

  // Reading the page only makes sense once a goto has happened, so that
  // assumption is checked here in one place.
  function requireCurrentPage(): ScriptedPage {
    if (!currentPage) {
      throw new Error("no page has loaded yet — call goto before reading the page");
    }
    return currentPage;
  }

  return {
    async goto(
      _url: string,
      _options?: { waitUntil?: "domcontentloaded"; timeout?: number },
    ): Promise<ResolutionResponse | null> {
      if (nextIndex >= script.length) {
        throw new Error(
          "ran off the end of the script — this walk needed another scripted page",
        );
      }
      const page = script[nextIndex];
      nextIndex += 1;

      if (page.failsToLoad) {
        // A hop the browser could not load at all: no responses fire, and
        // the walk never lands here.
        throw new Error(`failed to load ${page.url}`);
      }

      // No explicit responses scripted means a plain 200 at the page's own URL.
      const responses = page.responses ?? [{ url: page.url, status: 200 }];
      const resolutionResponses = responses.map(toResolutionResponse);

      // Every response this hop produced is announced to listeners, in order,
      // before goto resolves — mirroring how a real page fires "response"
      // events as it fetches.
      for (const response of resolutionResponses) {
        for (const handler of handlers) {
          handler(response);
        }
      }

      currentPage = page;
      return resolutionResponses[0] ?? null;
    },

    url() {
      return requireCurrentPage().url;
    },

    async content() {
      return requireCurrentPage().html ?? "";
    },

    async title() {
      return requireCurrentPage().title ?? "";
    },

    async $$eval<T>(selector: string, fn: (elements: PageAnchor[]) => T): Promise<T> {
      const page = requireCurrentPage();
      const { document } = parseHTML(`<html><body>${page.html ?? ""}</body></html>`);

      // linkedom does not resolve relative hrefs the way a browser does, so
      // every anchor's href is rewritten to its absolute form here — against
      // the page's own settled URL — before anything reads it. An anchor
      // with no href attribute is left untouched, since that is how the walk
      // tells a real link apart from a modal trigger with nothing to follow.
      for (const anchor of document.querySelectorAll("a")) {
        const href = anchor.getAttribute("href");
        if (href !== null) {
          anchor.setAttribute("href", new URL(href, page.url).href);
        }
      }

      const elements = [...document.querySelectorAll(selector)];
      return fn(elements);
    },

    on(_event: "response", handler: (response: ResolutionResponse) => void) {
      handlers.push(handler);
    },

    off(_event: "response", handler: (response: ResolutionResponse) => void) {
      handlers = handlers.filter((registered) => registered !== handler);
    },
  };
}
