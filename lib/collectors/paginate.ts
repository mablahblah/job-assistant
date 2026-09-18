// The pagination loop shared by every browser-based job collector. It knows
// nothing about a browser: the caller supplies a way to read the cards on the
// current page and a way to move to the next one, and this loop decides when
// the search has gathered enough, run dry, or gone wrong.

import { isPastThreshold, parseAgeToDays } from "../utils/job-age";
import { messageFromThrown } from "../utils/thrown-message";

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
  // The label this search was given, so a check running after the collector's
  // whole set of searches can name the ones that came back empty.
  search: string;
  cards: ResultCard[];
  warnings: string[];
  // True when a self-check fired — no cards at all, or a card selector
  // yielding on fewer than half the elements it matched. It is what decides
  // whether the search is trustworthy enough to refresh the saved fixture,
  // so a stop for an old card or a dead page does not set it.
  selfCheckFailed: boolean;
  // True when the search read no cards at all. On its own that is ordinary —
  // a site has no jobs matching this search — so it is reported rather than
  // warned about, and noCardsWarnings below decides what it means.
  foundNoCards: boolean;
}

// However deep a site's results go, one search never reads further than this.
// Reaching it means the date-based stop did not work, which is worth a warning.
export const PAGE_LIMIT = 6;

// Why the loop ended. Staying null is what earns the ceiling warning, so it
// is tracked outright rather than guessed at from the turn count.
type StopReason = "unreadable-age" | "threshold" | "limit" | "exhausted" | "failure";

// Every warning is built in exactly one place, so its wording can change
// without touching the loop that decides when it fires.
function unreadableAgeWarning(search: string, age: string): string {
  return `${search}: could not read the age "${age}" on a result card, so the search stopped`;
}

function limitWarning(search: string): string {
  return `${search}: stopped at the ${PAGE_LIMIT}-page ceiling, so the date-based stop never fired`;
}

function noCardsAnywhereWarning(searches: number): string {
  return `no result cards were found in any of its ${searches} searches, so the card selector may have broken`;
}

function noCardsForSearchWarning(search: string): string {
  return `${search}: found no result cards, so the search term may be wrong or the site may have stopped carrying this kind of job`;
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

  for (let turn = 0; turn < PAGE_LIMIT; turn++) {
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
        // Failing open would let a site's reworded cards rewrite its whole
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
    if (turn === PAGE_LIMIT - 1) break;

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
    warnings.push(limitWarning(search));
  }

  let selfCheckFailed = false;

  // Skipped after a failure, which already says why nothing came back. No
  // warning of its own: an empty search is only worth reporting once every
  // search has been tried, so the fact travels out on the result instead. It
  // still fails the self-check, which keeps an empty page out of the fixture.
  const foundNoCards = stopReason !== "failure" && readCardsTotal === 0;
  if (foundNoCards) {
    selfCheckFailed = true;
  }

  // Strictly under half. Exactly half is the boundary and does not warn.
  if (matchedTotal > 0 && readCardsTotal * 2 < matchedTotal) {
    warnings.push(poorYieldWarning(search, readCardsTotal, matchedTotal));
    selfCheckFailed = true;
  }

  return { search, cards, warnings, selfCheckFailed, foundNoCards };
}

// Whether a collector's empty searches are worth telling the user about.
//
// A broken card selector still reads as every search finding nothing, so that
// stays one line about the collector rather than one per search — the
// collector is what would need fixing, not any one search term. But an empty
// search sitting next to siblings that found cards proves the selector works,
// which rules out that explanation and leaves only ones specific to that
// search: the term stopped matching, or the site stopped carrying that kind
// of job. Either is something the user can fix, and folding it into a summary
// that only fires when everything is empty would hide it behind the searches
// that worked.
export function noCardsWarnings(results: readonly PaginateResult[]): string[] {
  if (results.length === 0) return [];
  const empty = results.filter((result) => result.foundNoCards);
  if (empty.length === 0) return [];
  if (empty.length === results.length) return [noCardsAnywhereWarning(results.length)];
  return empty.map((result) => noCardsForSearchWarning(result.search));
}
