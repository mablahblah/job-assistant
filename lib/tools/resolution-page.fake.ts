// A stand-in for a real browser page, used to test the URL resolver's page
// loop without a browser. A test lays out the whole resolution up front as an
// ordered list of pages; each call to goto ignores the URL it is handed and
// simply serves the next page in that list. This lets a test say "start
// here, land there, then dead-end" without modelling a URL-to-page lookup.
import { parseHTML } from "linkedom";
import type { PageAnchor, ResolutionPage, ResolutionResponse } from "./resolution-page";

// One response a scripted page produced. A real page load fires many — the
// document itself, plus its images, scripts and advertising pixels — and
// resolution counts a refusal only on the ones the browser navigated to. A
// tracker that answers 403 is a response, not evidence the source turned us
// away, so a test needs to be able to script the difference.
interface ScriptedResponse {
  url: string;
  status: number;
  // Left out means the browser navigated to it. That is the default because
  // every response scripted across the suite is a page response, and a test
  // wanting a subresource is the rarer thing that should have to say so.
  isNavigation?: boolean;
}

export interface ScriptedPage {
  // The address the page ends on — what url() reports once this page is done.
  url: string;
  // The responses this page produced, in the order they arrived. The first is
  // what goto hands back; the last is the page actually ended on. Defaults to
  // a single 200 at `url`.
  responses?: ScriptedResponse[];
  // The page's HTML. Defaults to an empty string.
  html?: string;
  // The page's title. Defaults to an empty string.
  title?: string;
  // When true, goto rejects — the browser could not load this page at all.
  failsToLoad?: boolean;
  // Later renders this same page moves through, in order, the way a page that
  // is still loading does — reached one at a time by calling advance(). Each
  // entry may name any of url, html and title; a field it leaves out keeps
  // whatever value the page was last showing.
  becomes?: { url?: string; html?: string; title?: string }[];
}

// One render of a page: what url(), content() and title() report at a given
// point in that page's sequence.
interface PageRender {
  url: string;
  html?: string;
  title?: string;
}

// Wraps one scripted response as the ResolutionResponse shape resolution
// expects.
function toResolutionResponse(response: ScriptedResponse): ResolutionResponse {
  const isNavigation = response.isNavigation ?? true;
  return {
    status: () => response.status,
    url: () => response.url,
    request: () => ({ isNavigationRequest: () => isNavigation }),
  };
}

// Turns a page's own fields plus its becomes list into the full sequence of
// renders it moves through. Each later render starts from the one before it,
// so a field a becomes entry does not name carries forward unchanged.
function pageRenders(page: ScriptedPage): PageRender[] {
  const renders: PageRender[] = [{ url: page.url, html: page.html, title: page.title }];
  for (const change of page.becomes ?? []) {
    const previous = renders[renders.length - 1];
    renders.push({
      url: change.url ?? previous.url,
      html: change.html ?? previous.html,
      title: change.title ?? previous.title,
    });
  }
  return renders;
}

export function fakeResolutionPage(
  script: ScriptedPage[],
): ResolutionPage & { advance(): void } {
  // Which scripted page goto is up to. The first goto serves script[0].
  let nextIndex = 0;
  // The renders of the page resolution last ended on, and which one reads see
  // right now. Empty until the first goto.
  let renders: PageRender[] = [];
  let renderIndex = 0;
  // Everyone listening for "response" events, in registration order.
  let handlers: ((response: ResolutionResponse) => void)[] = [];

  // Reading the page only makes sense once a goto has happened, so that
  // assumption is checked here in one place.
  function requireCurrentRender(): PageRender {
    if (renders.length === 0) {
      throw new Error("no page has loaded yet — call goto before reading the page");
    }
    return renders[renderIndex];
  }

  return {
    async goto(
      _url: string,
      _options?: { waitUntil?: "domcontentloaded"; timeout?: number },
    ): Promise<ResolutionResponse | null> {
      if (nextIndex >= script.length) {
        throw new Error(
          "ran off the end of the script — this resolution needed another scripted page",
        );
      }
      const page = script[nextIndex];
      nextIndex += 1;

      if (page.failsToLoad) {
        // A page the browser could not load at all: no responses fire, and
        // resolution never lands here.
        throw new Error(`failed to load ${page.url}`);
      }

      // No explicit responses scripted means a plain 200 at the page's own URL.
      const responses = page.responses ?? [{ url: page.url, status: 200 }];
      const resolutionResponses = responses.map(toResolutionResponse);

      // Every response this page produced is announced to listeners, in order,
      // before goto resolves — mirroring how a real page fires "response"
      // events as it fetches.
      for (const response of resolutionResponses) {
        for (const handler of handlers) {
          handler(response);
        }
      }

      // A freshly loaded page starts at its own first render, whatever render
      // the page before it was left on.
      renders = pageRenders(page);
      renderIndex = 0;
      return resolutionResponses[0] ?? null;
    },

    url() {
      return requireCurrentRender().url;
    },

    async content() {
      return requireCurrentRender().html ?? "";
    },

    async title() {
      return requireCurrentRender().title ?? "";
    },

    async $$eval<T>(selector: string, fn: (elements: PageAnchor[]) => T): Promise<T> {
      const render = requireCurrentRender();
      const { document } = parseHTML(`<html><body>${render.html ?? ""}</body></html>`);

      // linkedom does not resolve relative hrefs the way a browser does, so
      // every anchor's href is rewritten to its absolute form here — against
      // the URL the page is currently showing — before anything reads it. An
      // anchor with no href attribute is left untouched, since that is how
      // resolution tells a real link apart from a modal trigger with nothing
      // to follow.
      for (const anchor of document.querySelectorAll("a")) {
        const href = anchor.getAttribute("href");
        if (href !== null) {
          anchor.setAttribute("href", new URL(href, render.url).href);
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

    // Moves the current page to its next scripted render. A no-op once the page
    // has reached its last render, and before any goto has loaded one — an
    // over-advance describes a page that simply stopped changing.
    advance() {
      if (renderIndex < renders.length - 1) {
        renderIndex += 1;
      }
    },
  };
}
