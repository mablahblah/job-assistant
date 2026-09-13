// Follows one job link toward the employer's own posting: loads a page, judges what it
// offers, and either follows a link or stops. It is handed a browser page and returns
// what happened — it opens nothing, stores nothing, and knows nothing about jobs.

import type { ApplyLink } from "../utils/apply-links";
import { filterApplyLinks } from "../utils/apply-links";
import { isBlacklistedUrl } from "../utils/blacklist";
import { detectDeadEndSignals } from "../utils/dead-end-signals";
import { decideNextAction } from "../utils/decide-next-action";
import type { ResolutionPage, ResolutionResponse } from "../tools/resolution-page";
import { waitForPageToLoad } from "./wait-for-page-to-load";
import { isSameDomain } from "../utils/url-domain";
import { urlAnnouncesError } from "../utils/url-error-flag";

const DEFAULT_MAX_PAGES = 4;
const DEFAULT_TIMEOUT_MS = 15000;

export type ResolutionOutcome =
  | {
      outcome: "resolved";
      resolvedUrl: string;
      reason:
        | "no_apply_links"
        | "link_left_site"
        | "stayed_on_site"
        | "page_limit_reached";
    }
  | {
      outcome: "failed";
      reason:
        | "page_unavailable"
        | "page_refused"
        | "page_load_failed"
        | "dead_end"
        | "page_limit_reached"
        | "posting_gone";
    }
  | { outcome: "blacklisted" };

export interface ResolveJobUrlOptions {
  maxPages?: number;
  waitForLoad?: (page: ResolutionPage) => Promise<void>;
  timeoutMs?: number;
}

// A page is usable only when the server said yes.
function isSuccessStatus(status: number): boolean {
  return status >= 200 && status <= 299;
}

// Two populations hide inside "the server said no", and they want opposite
// treatment. A 403 or a 429 is the source rate-limiting us and a 5xx is the
// source unwell; all three are about this moment, and the same request an
// hour later may well be answered. Everything else non-success — a 404 for a
// filled job, a 401 wanting a login we do not have — is the same answer on
// every run. Only the first group is worth asking again.
function isRefusalStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

// The status of the page actually being looked at. A page can load fine and then jump
// somewhere that refuses, so the last response recorded for the settled address wins;
// goto's own response only ever describes the first page.
function statusOfFinalPage(
  recorded: ResolutionResponse[],
  finalUrl: string,
  gotoResponse: ResolutionResponse | null,
): number | undefined {
  for (let i = recorded.length - 1; i >= 0; i--) {
    const response = recorded[i];
    if (response.url() === finalUrl) return response.status();
  }
  return gotoResponse?.status();
}

// Whether any page the browser navigated to was refused, wherever in the chain
// it sat. Reading only the settled address is not enough: measured on
// 2026-09-12, an aggregator redirected a job link to a token-bearing address
// that answered 403 and then bounced on to a page that answered 200, and a
// whole run of that source recorded not one refusal while full-page 403s were
// watched going past. Only a navigation counts. One measured page load fired
// about 69 responses — the posting plus its images, scripts and advertising
// pixels — and a refused tracker says nothing about whether the source is
// turning us away.
function chainWasRefused(recorded: ResolutionResponse[]): boolean {
  return recorded.some(
    (response) => response.request().isNavigationRequest() && isRefusalStatus(response.status()),
  );
}

export async function resolveJobUrl(
  startUrl: string,
  page: ResolutionPage,
  options?: ResolveJobUrlOptions,
): Promise<ResolutionOutcome> {
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;
  const waitForLoad = options?.waitForLoad ?? waitForPageToLoad;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let currentUrl = startUrl;
  // Where resolution stood before this page, so a page can be undone after the fact.
  let previousUrl: string | undefined;

  for (let pagesOpened = 0; pagesOpened < maxPages; pagesOpened++) {
    const recorded: ResolutionResponse[] = [];
    const record = (response: ResolutionResponse): void => {
      recorded.push(response);
    };

    let finalUrl = "";
    let status: number | undefined;

    // Listening has to start before the load, or the redirect chain is missed.
    page.on("response", record);
    try {
      let gotoResponse: ResolutionResponse | null;
      try {
        gotoResponse = await page.goto(currentUrl, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
      } catch {
        return { outcome: "failed", reason: "page_load_failed" };
      }

      await waitForLoad(page);
      finalUrl = page.url();
      status = statusOfFinalPage(recorded, finalUrl, gotoResponse);
    } finally {
      page.off("response", record);
    }

    // Asked of the whole chain rather than of where it settled: a refusal
    // earlier on does not un-happen because the source then sent the browser
    // somewhere that answered. A redirect is a navigation but is not a
    // refusal, so an ordinary chain passes straight through.
    if (chainWasRefused(recorded)) {
      return { outcome: "failed", reason: "page_refused" };
    }

    if (status !== undefined && !isSuccessStatus(status)) {
      return {
        outcome: "failed",
        reason: isRefusalStatus(status) ? "page_refused" : "page_unavailable",
      };
    }

    // Read straight after the status, because a page can answer 200 while its
    // own address says the job id is gone. Measured on a real run: a board
    // redirected a dead posting to the employer's whole listing, 95 jobs on
    // one page, and it saved as the posting. The address is the only evidence
    // there, so it is read before anything looks at the page itself.
    if (urlAnnouncesError(finalUrl)) {
      return { outcome: "failed", reason: "posting_gone" };
    }

    // Judged on where the page settled, not where the page aimed.
    if (isBlacklistedUrl(finalUrl)) {
      return { outcome: "blacklisted" };
    }

    const html = await page.content();
    if (detectDeadEndSignals(html).isDeadEnd) {
      // A page that stayed on the same host led to an application form, so the page
      // before it is the posting. An off-host page came from an aggregator, and
      // stepping back there gains nothing.
      if (previousUrl !== undefined && isSameDomain(previousUrl, finalUrl)) {
        return {
          outcome: "resolved",
          resolvedUrl: previousUrl,
          reason: "stayed_on_site",
        };
      }
      return { outcome: "failed", reason: "dead_end" };
    }

    const rawLinks = await page.$$eval("a", (anchors) =>
      anchors.map((anchor) => ({
        href: anchor.href ?? "",
        text: anchor.textContent?.trim() ?? "",
      })),
    );
    const applyLinks: ApplyLink[] = filterApplyLinks(rawLinks);

    // There is room for one more page inside the limit.
    const pagesLeft = pagesOpened + 1 < maxPages;
    const decision = decideNextAction(applyLinks, pagesLeft);

    if (decision.action === "follow") {
      // Followed blind — the host comparison only happens once the page has finished loading.
      previousUrl = finalUrl;
      currentUrl = decision.nextUrl;
      continue;
    }

    if (decision.action === "budget_spent") {
      // The unfollowed link decides: same host means it was the application form and
      // resolution already stands on the posting; a different host means the posting
      // sits somewhere resolution never reached.
      return isSameDomain(decision.unfollowedUrl, finalUrl)
        ? { outcome: "resolved", resolvedUrl: finalUrl, reason: "page_limit_reached" }
        : { outcome: "failed", reason: "page_limit_reached" };
    }

    // Nothing worth following here, so this is the end of resolution.
    if (previousUrl === undefined) {
      return { outcome: "resolved", resolvedUrl: finalUrl, reason: "no_apply_links" };
    }
    if (isSameDomain(previousUrl, finalUrl)) {
      return {
        outcome: "resolved",
        resolvedUrl: previousUrl,
        reason: "stayed_on_site",
      };
    }
    return { outcome: "resolved", resolvedUrl: finalUrl, reason: "link_left_site" };
  }

  // Unreachable: the last page never follows a link, because its budget is spent.
  return { outcome: "failed", reason: "page_limit_reached" };
}
