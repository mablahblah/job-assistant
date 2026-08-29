// The pagination loop shared by every browser-based job collector. It knows
// nothing about a browser: the caller supplies a way to read the cards on the
// current page and a way to move to the next one, and this loop decides when
// the search has gathered enough, run dry, or gone wrong.

import { isPastThreshold, parseAgeToDays } from "../job-age";

// One result card as a collector reads it off a page. company is empty when
// the card names no employer: the card is still a card, and the job it becomes
// is dropped later by the rule that names the reason.
export interface ResultCard {
  url: string;
  title: string;
  age: string;
  company: string;
}

// What one page read yields: the cards that came back whole, and how many
// elements the card selector matched in all. The two differ when a selector
// has drifted and is matching things that are not job cards.
export interface PageRead {
  cards: ResultCard[];
  matched: number;
}

export interface PaginateOptions {
  // Names this search in every warning, since one collector runs several and
  // a broken search stays silent while its neighbours still return cards.
  search: string;
  readPage: () => Promise<PageRead>;
  // Resolving false means there is no next page.
  advance: () => Promise<boolean>;
  // Days. A card at or past this age stops the search.
  threshold: number;
  // Stop after this many cards. Infinity means no cap.
  limit: number;
}

export interface PaginateResult {
  cards: ResultCard[];
  warnings: string[];
  // True when a self-check fired — no cards at all, or a card selector
  // yielding on fewer than half the elements it matched. It is what decides
  // whether the search is trustworthy enough to refresh the saved fixture,
  // so a stop for an old card or a dead page does not set it.
  selfCheckFailed: boolean;
}

// However deep a site's results go, one search never walks further than this.
// Reaching it means the date-based stop did not work, which is worth a warning.
export const PAGE_CEILING = 6;

// Why the loop ended. Staying null is what earns the ceiling warning, so it
// is tracked outright rather than guessed at from the turn count.
type StopReason = "unreadable-age" | "threshold" | "limit" | "exhausted" | "failure";

// A thrown value is not guaranteed to be an Error — a browser operation can
// reject with a plain object like { code: "ECONNRESET" }, which String()
// flattens to the useless "[object Object]". Anything that is not an Error or
// a string is rendered as JSON instead.
function messageFromThrown(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  if (typeof thrown === "string") return thrown;
  if (thrown === undefined) return "undefined";
  if (thrown === null) return "null";
  try {
    return JSON.stringify(thrown);
  } catch {
    return String(thrown);
  }
}

// Every warning is built in exactly one place, so its wording can change
// without touching the loop that decides when it fires.
function unreadableAgeWarning(search: string, age: string): string {
  return `${search}: could not read the age "${age}" on a result card, so the search stopped`;
}

function ceilingWarning(search: string): string {
  return `${search}: stopped at the ${PAGE_CEILING}-page ceiling, so the date-based stop never fired`;
}

function noCardsWarning(search: string): string {
  return `${search}: no result cards were found`;
}

function poorYieldWarning(search: string, readCards: number, matched: number): string {
  return `${search}: only ${readCards} of ${matched} matched elements yielded a card`;
}

function readPageFailureWarning(search: string, thrown: unknown): string {
  return `${search}: reading a page failed: ${messageFromThrown(thrown)}`;
}

function advanceFailureWarning(search: string, thrown: unknown): string {
  return `${search}: advancing to the next page failed: ${messageFromThrown(thrown)}`;
}

export async function paginate(options: PaginateOptions): Promise<PaginateResult> {
  const { search, readPage, advance, threshold, limit } = options;
  const cards: ResultCard[] = [];
  const warnings: string[] = [];

  // The two self-checks at the bottom read these totals once, over the whole
  // search. Checked per page instead, one thin page early on would cry wolf.
  let readCardsTotal = 0;
  let matchedTotal = 0;
  let stopReason: StopReason | null = null;

  for (let turn = 0; turn < PAGE_CEILING; turn++) {
    let page: PageRead;
    try {
      page = await readPage();
    } catch (thrown) {
      warnings.push(readPageFailureWarning(search, thrown));
      stopReason = "failure";
      break;
    }

    // Counted for every card the page yielded, whatever becomes of it next.
    // A card dropped for being too old still proves the selector worked.
    readCardsTotal += page.cards.length;
    matchedTotal += page.matched;

    let stopping = false;
    for (const pageCard of page.cards) {
      const days = parseAgeToDays(pageCard.age);
      if (days === null) {
        // Failing open would let a site's reworded cards walk its whole
        // history, every run, in silence.
        warnings.push(unreadableAgeWarning(search, pageCard.age));
        stopReason = "unreadable-age";
        stopping = true;
        break;
      }
      if (isPastThreshold(days, threshold)) {
        stopReason = "threshold";
        stopping = true;
        break;
      }
      cards.push(pageCard);
      if (cards.length >= limit) {
        stopReason = "limit";
        stopping = true;
        break;
      }
    }

    // A stop found mid-page ends the search outright. Nothing after the
    // stopping card is kept, and no further page is asked for.
    if (stopping) break;

    if (page.cards.length === 0) {
      stopReason = "exhausted";
      break;
    }

    // On the last turn the ceiling ends the search anyway, so advancing here
    // would load a page nothing ever reads.
    if (turn === PAGE_CEILING - 1) break;

    let hasNextPage: boolean;
    try {
      hasNextPage = await advance();
    } catch (thrown) {
      warnings.push(advanceFailureWarning(search, thrown));
      stopReason = "failure";
      break;
    }

    if (!hasNextPage) {
      stopReason = "exhausted";
      break;
    }
  }

  if (stopReason === null) {
    warnings.push(ceilingWarning(search));
  }

  let selfCheckFailed = false;

  // Skipped after a failure, which already says why nothing came back.
  if (stopReason !== "failure" && readCardsTotal === 0) {
    warnings.push(noCardsWarning(search));
    selfCheckFailed = true;
  }

  // Strictly under half. Exactly half is the boundary and does not warn.
  if (matchedTotal > 0 && readCardsTotal * 2 < matchedTotal) {
    warnings.push(poorYieldWarning(search, readCardsTotal, matchedTotal));
    selfCheckFailed = true;
  }

  return { cards, warnings, selfCheckFailed };
}
