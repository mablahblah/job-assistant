// Walks one job link toward the employer's own posting: loads a page, judges what it
// offers, and either follows a link or stops. It is handed a browser page and returns
// what happened — it opens nothing, stores nothing, and knows nothing about jobs.

import type { ApplyLink } from "./apply-links";
import { filterApplyLinks } from "./apply-links";
import { isBlacklistedUrl } from "./blacklist";
import { detectDeadEndSignals } from "./dead-end-signals";
import { decideNextAction } from "./decide-next-action";
import type { ResolutionPage, ResolutionResponse } from "./resolution-page";
import { settlePage } from "./settle-page";
import { isSameDomain } from "./url-domain";

const DEFAULT_MAX_HOPS = 4;
const DEFAULT_TIMEOUT_MS = 15000;

export type ResolutionOutcome =
  | {
      outcome: "resolved";
      resolvedUrl: string;
      reason:
        | "no_apply_links"
        | "walked_off_domain"
        | "same_domain_hop_discarded"
        | "hop_budget_spent";
    }
  | {
      outcome: "failed";
      reason: "page_unavailable" | "page_load_failed" | "dead_end" | "hop_budget_spent";
    }
  | { outcome: "blacklisted" };

export interface ResolveJobUrlOptions {
  maxHops?: number;
  settle?: (page: ResolutionPage) => Promise<void>;
  timeoutMs?: number;
}

// A page is usable only when the server said yes.
function isSuccessStatus(status: number): boolean {
  return status >= 200 && status <= 299;
}

// The status of the page actually being looked at. A page can load fine and then jump
// somewhere that refuses, so the last response recorded for the settled address wins;
// goto's own response only ever describes the first page.
function statusOfLandedPage(
  recorded: ResolutionResponse[],
  landedUrl: string,
  gotoResponse: ResolutionResponse | null,
): number | undefined {
  for (let i = recorded.length - 1; i >= 0; i--) {
    const response = recorded[i];
    if (response.url() === landedUrl) return response.status();
  }
  return gotoResponse?.status();
}

export async function resolveJobUrl(
  startUrl: string,
  page: ResolutionPage,
  options?: ResolveJobUrlOptions,
): Promise<ResolutionOutcome> {
  const maxHops = options?.maxHops ?? DEFAULT_MAX_HOPS;
  const settle = options?.settle ?? settlePage;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let currentUrl = startUrl;
  // Where the walk stood before this hop, so a hop can be undone after the fact.
  let previousUrl: string | undefined;

  for (let hop = 0; hop < maxHops; hop++) {
    const recorded: ResolutionResponse[] = [];
    const record = (response: ResolutionResponse): void => {
      recorded.push(response);
    };

    let landedUrl = "";
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

      await settle(page);
      landedUrl = page.url();
      status = statusOfLandedPage(recorded, landedUrl, gotoResponse);
    } finally {
      page.off("response", record);
    }

    if (status !== undefined && !isSuccessStatus(status)) {
      return { outcome: "failed", reason: "page_unavailable" };
    }

    // Judged on where the page settled, not where the hop aimed.
    if (isBlacklistedUrl(landedUrl)) {
      return { outcome: "blacklisted" };
    }

    const html = await page.content();
    if (detectDeadEndSignals(html).isDeadEnd) {
      // A hop that stayed on the same host led to an application form, so the page
      // before it is the posting. An off-host hop came from an aggregator, and
      // stepping back there gains nothing.
      if (previousUrl !== undefined && isSameDomain(previousUrl, landedUrl)) {
        return {
          outcome: "resolved",
          resolvedUrl: previousUrl,
          reason: "same_domain_hop_discarded",
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

    // Budget remains while one more page still fits inside the ceiling.
    const hopBudgetRemains = hop + 1 < maxHops;
    const decision = decideNextAction(applyLinks, hopBudgetRemains);

    if (decision.action === "follow") {
      // Followed blind — the host comparison only happens once the page has landed.
      previousUrl = landedUrl;
      currentUrl = decision.nextUrl;
      continue;
    }

    if (decision.action === "budget_spent") {
      // The unfollowed link decides: same host means it was the application form and
      // the walk already stands on the posting; a different host means the posting
      // sits somewhere the walk never reached.
      return isSameDomain(decision.unfollowedUrl, landedUrl)
        ? { outcome: "resolved", resolvedUrl: landedUrl, reason: "hop_budget_spent" }
        : { outcome: "failed", reason: "hop_budget_spent" };
    }

    // Nothing worth following here, so this is the end of the walk.
    if (previousUrl === undefined) {
      return { outcome: "resolved", resolvedUrl: landedUrl, reason: "no_apply_links" };
    }
    if (isSameDomain(previousUrl, landedUrl)) {
      return {
        outcome: "resolved",
        resolvedUrl: previousUrl,
        reason: "same_domain_hop_discarded",
      };
    }
    return { outcome: "resolved", resolvedUrl: landedUrl, reason: "walked_off_domain" };
  }

  // Unreachable: the last hop never follows a link, because its budget is spent.
  return { outcome: "failed", reason: "hop_budget_spent" };
}
