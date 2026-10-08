// A stand-in for the browser that follows job links in tests. It answers
// goto() from the same kind of page table the stand-in website (page-fetcher.fake)
// uses, so a test can drive the resolver without a real browser or network.
import { parseHTML } from "linkedom";
import type {
  OpenPage,
  PageAnchor,
  ResolutionBrowserFactory,
  ResolutionBrowserSession,
  ResolutionPage,
  ResolutionResponse,
} from "./resolution-page";
import type { SitePages } from "./page-fetcher.fake";

// How many redirects a chain may hop through before we assume it loops forever.
const MAX_REDIRECTS = 10;

type ResponseListener = (response: ResolutionResponse) => void;

// A page is looked up by its host (port dropped) plus its path and query.
function pageKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
}

// Follows one goto() through however many redirects the table chains together,
// announcing every hop's response to the listeners in order, and returns the
// first response along with where the chain actually ended up.
async function followChain(
  startUrl: string,
  pages: SitePages,
  listeners: Set<ResponseListener>,
): Promise<{ response: ResolutionResponse; finalUrl: string; finalBody: string }> {
  let currentUrl = startUrl;
  let firstResponse: ResolutionResponse | undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (hop === MAX_REDIRECTS) {
      throw new Error(`fakeResolutionBrowser: redirect loop following ${startUrl}`);
    }

    const sitePage = pages[pageKey(currentUrl)];

    if (sitePage?.hang) {
      // A page that never loads: the real browser's goto would time out.
      throw new Error(`fakeResolutionBrowser: page at ${currentUrl} hangs`);
    }

    const status = sitePage?.redirectTo ? 302 : (sitePage?.status ?? (sitePage ? 200 : 404));
    const respondingUrl = currentUrl;
    const response: ResolutionResponse = {
      status: () => status,
      url: () => respondingUrl,
      request: () => ({ isNavigationRequest: () => true }),
    };
    firstResponse ??= response;
    for (const listener of listeners) {
      listener(response);
    }

    if (!sitePage?.redirectTo) {
      return { response: firstResponse, finalUrl: currentUrl, finalBody: sitePage?.body ?? "" };
    }

    currentUrl = new URL(sitePage.redirectTo, currentUrl).href;
  }

  // Unreachable: the loop above always returns or throws first.
  throw new Error(`fakeResolutionBrowser: redirect loop following ${startUrl}`);
}

function createPage(pages: SitePages, visits: string[]): OpenPage {
  let finalUrl = "";
  let finalBody = "";
  const listeners = new Set<ResponseListener>();

  const page: ResolutionPage = {
    async goto(url) {
      visits.push(pageKey(url));
      const result = await followChain(url, pages, listeners);
      finalUrl = result.finalUrl;
      finalBody = result.finalBody;
      return result.response;
    },

    url() {
      return finalUrl;
    },

    async content() {
      return finalBody;
    },

    async title() {
      const { document } = parseHTML(`<html><body>${finalBody}</body></html>`);
      return document.querySelector("title")?.textContent ?? "";
    },

    async $$eval<T>(selector: string, fn: (elements: PageAnchor[]) => T): Promise<T> {
      const { document } = parseHTML(`<html><body>${finalBody}</body></html>`);
      for (const anchor of document.querySelectorAll("a")) {
        const href = anchor.getAttribute("href");
        if (href !== null) {
          anchor.setAttribute("href", new URL(href, finalUrl).href);
        }
      }
      const elements = [...document.querySelectorAll(selector)];
      return fn(elements as unknown as PageAnchor[]);
    },

    on(event, handler) {
      if (event === "response") {
        listeners.add(handler);
      }
    },

    off(event, handler) {
      if (event === "response") {
        listeners.delete(handler);
      }
    },
  };

  return {
    page,
    close: async () => {},
  };
}

export function fakeResolutionBrowser(pages: SitePages): ResolutionBrowserFactory & { visits: string[] } {
  const visits: string[] = [];

  const factory = (async (): Promise<ResolutionBrowserSession> => ({
    openPage: async () => createPage(pages, visits),
    close: async () => {},
  })) as ResolutionBrowserFactory & { visits: string[] };

  factory.visits = visits;
  return factory;
}
