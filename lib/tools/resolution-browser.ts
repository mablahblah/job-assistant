// The tool that wraps Playwright for one URL-resolution run. Everything else
// in this codebase that talks to the outside world is reached through a tool
// like this one, so the orchestrator can hand the resolution step a browser
// it actually launched in a real run, or a small stand-in in a test, without
// either side knowing which it got. `createResolutionBrowser` takes its
// launcher as an argument, rather than calling `chromium.launch` itself,
// for exactly that reason: a function that always launches a real browser
// cannot be handed a fake, and every test that touched it would need a real
// Chromium window.
import { chromium } from "playwright";
import type {
  ResolutionBrowserSession,
  ResolutionPage,
  ResolutionPageLease,
} from "../resolution-page";

// Resolution runs headed and the mode is deliberately not configurable.
// Measured directly against Adzuna's `/land/ad/` redirector: 26 of 26
// headless requests were refused, none of 6 headed ones were, and
// overriding the user-agent did not change the outcome. `as const` is what
// makes `.headless` narrow to the literal `false` rather than widen to
// `boolean`, so a test can assert the browser is headed without opening one.
export const HEADED_LAUNCH_OPTIONS = { headless: false } as const;

// A context is one job's slice of the browser: its own cookies, its own
// consent state. Closing it is how one job's walk avoids leaving anything
// behind for the next job's walk to inherit.
export interface LaunchedContext {
  newPage(): Promise<ResolutionPage>;
  close(): Promise<void>;
}

// Deliberately narrower than Playwright's real `Browser` — it names only the
// one method this tool calls on it, besides `close`. Because it asks for
// less than the real thing, a real Playwright browser satisfies it with no
// adapter and no cast, and a recording stand-in built for a test can satisfy
// it just as easily.
export interface LaunchedBrowser {
  newContext(): Promise<LaunchedContext>;
  close(): Promise<void>;
}

// How a browser gets launched, kept separate from the tool that uses one.
// The default below is Playwright's own `chromium.launch`; a test passes its
// own launcher instead, so it can watch what the tool does without ever
// starting Chromium.
export type BrowserLauncher = () => Promise<LaunchedBrowser>;

// `chromium.launch` returns a real Playwright `Browser`, which satisfies
// `LaunchedBrowser` structurally, so this needs no adapting and no cast to
// serve as the default `launch`.
const defaultLaunch: BrowserLauncher = () => chromium.launch(HEADED_LAUNCH_OPTIONS);

// Builds the session a resolution run walks in. `launch` is optional and
// defaults to a real Chromium launch, which is what lets this function
// satisfy `ResolutionBrowserFactory` — the orchestrator calls it with no
// arguments in a real run, and a test calls it with its own launcher.
export async function createResolutionBrowser(
  launch: BrowserLauncher = defaultLaunch
): Promise<ResolutionBrowserSession> {
  // The browser is launched once, here, for the whole run — not once per
  // job — so however many jobs get walked, only one Chromium process opens.
  const browser = await launch();

  return {
    async openPage(): Promise<ResolutionPageLease> {
      // A fresh context per job is the whole point: it starts with no
      // cookies and no consent state from whatever job was walked before it.
      const context = await browser.newContext();
      const page = await context.newPage();
      return {
        page,
        // Closing the lease closes this job's context, not the browser —
        // the browser stays open for the jobs still waiting their turn.
        close: () => context.close(),
      };
    },
    close: () => browser.close(),
  };
}
