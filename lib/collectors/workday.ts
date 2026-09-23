// Polls Workday's public CXS job-search endpoint for postings whose title
// matches the user's search terms. One search per term, not one search with
// all terms: Workday's search re-sorts the whole board by relevance rather
// than narrowing it, so our own title filter (matchesSearchTerms) decides
// what is kept, and it has to be run against each term separately.
import {
  jobFieldsFromWorkdayListing,
  partsFromWorkdayBoard,
  workdayJobListUrl,
  workdayPostingUrl,
  type WorkdayBoardParts,
  type WorkdayJobListing,
  type WorkdayJobListResponse,
} from "../utils/workday-fields";
import type { JobListEntry } from "../types/job-list-entry";
import { matchesSearchTerms } from "../utils/search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { messageFromThrown } from "../utils/thrown-message";
import { BROWSER_USER_AGENT } from "../tools/page-fetcher";
import type { Collector, CollectorResult } from "./collector";

// The collector's own name, which is what a slug row carries when its board
// is on this collector's polling list.
const COLLECTOR = "workday";

// Measured 2026-09-21: asking Workday's search for more than 20 results a
// page returns nothing, so this is fixed, not configurable.
const PAGE_SIZE = 20;
// A hard ceiling so a board that never runs dry (or never stops matching)
// can't page forever.
const PAGE_CEILING = 50;

function toJobListEntry(
  listing: WorkdayJobListing,
  parts: WorkdayBoardParts,
  boardSlug: string
): JobListEntry {
  const url = workdayPostingUrl(parts, listing.externalPath);
  // No description and no date come back from this endpoint, so every job
  // this collector finds still needs the parser to read its posting.
  return {
    original_url: url,
    resolved_url: url,
    ...jobFieldsFromWorkdayListing(listing, boardSlug),
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

// Fetches one page of one term's search. Returns the page's listings, or a
// warning if the request, its status, or its body broke.
async function fetchWorkdayPage(
  parts: WorkdayBoardParts,
  term: string,
  offset: number,
  boardLabel: string
): Promise<{ listings: WorkdayJobListing[] } | { warning: string }> {
  let res: Response;
  try {
    res = await fetchWithTimeout(workdayJobListUrl(parts), {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": BROWSER_USER_AGENT },
      body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: term }),
    });
  } catch (thrown) {
    // The request itself never got a reply — same degraded-run case as an
    // error status, so the remaining boards still get their turn.
    return { warning: `workday board "${boardLabel}": ${messageFromThrown(thrown)}` };
  }
  if (!res.ok) {
    // A dead board is a degraded run, not a failed collector, so the
    // remaining boards still get their turn.
    return { warning: httpError(`workday board "${boardLabel}"`, res.status).message };
  }
  let body: WorkdayJobListResponse;
  try {
    body = await safeJson<WorkdayJobListResponse>(res, `workday board "${boardLabel}"`);
  } catch (thrown) {
    // safeJson's own message already names the board, so it is used as-is.
    return { warning: messageFromThrown(thrown) };
  }
  return { listings: body.jobPostings ?? [] };
}

export const workdayCollector: Collector = {
  name: "workday",

  async collect({ settings, atsSlugs, limit }): Promise<CollectorResult> {
    const { boards, warnings } = await readAtsBoards(atsSlugs, COLLECTOR);
    if (boards.length === 0) {
      return { jobs: [], errors: [], warnings };
    }

    const searchTerms = await settings.getSearchTerms();
    const jobs: JobListEntry[] = [];

    for (const board of boards) {
      if (jobs.length >= limit) break;

      const parts = partsFromWorkdayBoard(board.ats_slug);
      if (!parts) {
        warnings.push(`workday board "${board.ats_slug}" is not a company, data centre and site`);
        continue;
      }

      // Collected once per board: a job two terms both find (or a page
      // that repeats one already seen) is kept only the first time.
      const collectedPaths = new Set<string>();
      let boardBroken = false;

      for (const term of searchTerms) {
        if (boardBroken || jobs.length >= limit) break;

        for (let page = 0; page < PAGE_CEILING; page++) {
          if (jobs.length >= limit) break;

          const result = await fetchWorkdayPage(parts, term, page * PAGE_SIZE, board.ats_slug);
          if ("warning" in result) {
            // The board is skipped for the rest of its terms, with one
            // warning; the next board still gets polled.
            warnings.push(result.warning);
            boardBroken = true;
            break;
          }

          // Stop rule 1: a page with no jobs at all.
          if (result.listings.length === 0) break;

          const kept = result.listings.filter(
            (listing) =>
              matchesSearchTerms(listing.title, [term]) &&
              !collectedPaths.has(listing.externalPath)
          );
          // Stop rule 2: a page where nothing on it is both a match for
          // this term and not already collected. (`total` in the reply is
          // never read — measured 2026-09-21, a board reported 0 on pages
          // that still held jobs, so it can't be trusted to say when to stop.)
          if (kept.length === 0) break;

          for (const listing of kept) {
            if (jobs.length >= limit) break;
            collectedPaths.add(listing.externalPath);
            jobs.push(toJobListEntry(listing, parts, board.ats_slug));
          }
          // Stop rule 3: the page ceiling, reached by exiting the for loop.
        }
      }
    }

    return { jobs, errors: [], warnings };
  },
};
