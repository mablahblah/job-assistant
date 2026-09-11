// A deliberately narrow slice of Playwright's Page and Response types, holding
// only the methods the URL-resolution walk calls. Because it asks for less than
// the real thing, a real Playwright page satisfies it with no adapter and no
// cast — and a fake page built for tests can satisfy it just as easily, so the
// hop-by-hop walk can be exercised offline.

export interface ResolutionResponse {
  // The HTTP status of one hop, used to tell a real page from a refusal
  // or a dead posting — both of which load without throwing.
  status(): number;
  // The address this response came from.
  url(): string;
}

// One anchor element, as far as the walk needs to see it. href is the
// resolved, absolute address a real browser reports (not the raw href
// attribute, which may be relative) — the walk compares the host it landed
// on against the host it came from, so it needs the resolved form. Both
// members are optional or nullable because an anchor can carry no href at
// all, which is how the walk recognises a modal trigger with nothing to follow.
export interface PageAnchor {
  href?: string;
  textContent?: string | null;
}

// One page in the browser, as far as the walk needs to see it.
export interface ResolutionPage {
  // Loads one hop and returns the response the navigation itself produced,
  // or null if the browser did not get one.
  goto(
    url: string,
    options?: { waitUntil?: "domcontentloaded"; timeout?: number },
  ): Promise<ResolutionResponse | null>;
  // The address the page settled on, which is not always the address goto
  // was given: a page can jump elsewhere client-side after loading.
  url(): string;
  // The page's HTML, read to spot a login wall, signup wall or paywall.
  content(): Promise<string>;
  // The page's title, read while waiting for a page to finish rendering.
  title(): Promise<string>;
  // Runs a function over the elements matching a selector. Used to read
  // the page's anchors.
  $$eval<T>(selector: string, fn: (elements: PageAnchor[]) => T): Promise<T>;
  // Subscribes to the responses the page fetches for itself. A page that
  // loads fine and then jumps to a refusing page reports success from goto
  // alone, so the walk listens here to learn the status of the page it
  // actually landed on.
  on(event: "response", handler: (response: ResolutionResponse) => void): void;
  // Unsubscribes a handler previously passed to on.
  off(event: "response", handler: (response: ResolutionResponse) => void): void;
}

// One page and the way to shut it down again. A real lease holds a browser
// context, so closing it takes that job's cookies and consent state with it
// and the next job's walk starts clean.
export interface OpenPage {
  page: ResolutionPage;
  close(): Promise<void>;
}

// Opens a fresh page for one job's walk. The resolution step is handed this
// rather than a browser, so it launches nothing of its own and a scripted
// fake stands in for Playwright with no adapter.
export type ResolutionPageFactory = () => Promise<OpenPage>;

// A browser open for one resolution run, and the way to shut it down again.
// One browser serves the whole run; every job takes its own page from it.
export interface ResolutionBrowserSession {
  openPage: ResolutionPageFactory;
  close(): Promise<void>;
}

// Launches the browser a resolution run walks in. The orchestrator calls this
// only once it knows there is work, so a run with nothing to resolve costs no
// browser and leaves the machine alone.
export type ResolutionBrowserFactory = () => Promise<ResolutionBrowserSession>;
