// Gives a newly-loaded page time to finish rendering before the walk judges
// it. A page "looks finished" once it carries enough anchors and a real
// title; until then this polls at a fixed interval until either condition is
// met or the time budget runs out. It never throws — the walk reads the page
// itself once this returns, however the page ended up.

import type { ResolutionPage } from "./resolution-page";

const DEFAULT_MIN_LINKS = 5;
const DEFAULT_BUDGET_MS = 15000;
const DEFAULT_INTERVAL_MS = 150;

export interface SettlePageOptions {
  minLinks?: number;
  budgetMs?: number;
  intervalMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

// The real sleep used outside tests.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A page looks finished once it carries enough anchors and a non-empty
// title. A read that throws — as $$eval does in a real browser when the
// page navigates mid-read — means the page moved on, which is exactly what
// settling is waiting for, so it counts as "not finished yet" rather than
// escaping as a failure.
async function looksFinished(
  page: ResolutionPage,
  minLinks: number,
): Promise<boolean> {
  try {
    const [linkCount, title] = await Promise.all([
      page.$$eval("a", (elements) => elements.length),
      page.title(),
    ]);
    return linkCount >= minLinks && title.trim().length > 0;
  } catch {
    return false;
  }
}

export async function settlePage(
  page: ResolutionPage,
  options: SettlePageOptions = {},
): Promise<void> {
  const {
    minLinks = DEFAULT_MIN_LINKS,
    budgetMs = DEFAULT_BUDGET_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    now = Date.now,
    wait = sleep,
  } = options;

  // Already done — no need to wait even once.
  if (await looksFinished(page, minLinks)) {
    return;
  }

  const deadline = now() + budgetMs;
  while (now() < deadline) {
    await wait(intervalMs);
    if (await looksFinished(page, minLinks)) {
      return;
    }
  }
  // Budget spent without settling — the walk judges the page as it stands.
}
