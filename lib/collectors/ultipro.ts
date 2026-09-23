// Polls each configured UltiPro board's whole job listing, paging through it
// 200 jobs at a time. UltiPro's list endpoint takes no search text, so every
// board is read once in full — matching against the configured search terms
// happens after the read, not per term, which is why there is one page-walk
// per board rather than one per term.
import {
  jobFieldsFromUltiproPosting,
  partsFromUltiproBoard,
  ultiproJobListUrl,
  ultiproPostingUrl,
  type UltiproBoardParts,
  type UltiproJobListResponse,
  type UltiproPosting,
} from "../utils/ultipro-fields";
import type { JobListEntry } from "../types/job-list-entry";
import { matchesSearchTerms } from "../utils/search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { messageFromThrown } from "../utils/thrown-message";
import { BROWSER_USER_AGENT } from "../tools/page-fetcher";
import type { Collector, CollectorResult } from "./collector";

// The collector's own name, which is what a slug row carries when its board
// is on this collector's polling list.
const COLLECTOR = "ultipro";
// Measured 2026-09-21: a request for 200 returned a whole 49-job board, so a
// reply with fewer than this many jobs is the board's last page.
const PAGE_SIZE = 200;

function toJobListEntry(
  opportunity: UltiproPosting,
  parts: UltiproBoardParts,
  boardSlug: string,
): JobListEntry {
  const url = ultiproPostingUrl(parts, opportunity.Id);
  // The list reply carries only a short BriefDescription, never the full
  // posting, so every job this collector finds still needs the parser.
  return {
    original_url: url,
    resolved_url: url,
    ...jobFieldsFromUltiproPosting(opportunity, boardSlug),
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

// Fetches one page of one board's whole listing. Returns the page's
// opportunities, or a warning if the request, its status, or its body broke.
async function fetchUltiproPage(
  parts: UltiproBoardParts,
  skip: number,
  boardLabel: string,
): Promise<{ opportunities: UltiproPosting[] } | { warning: string }> {
  let res: Response;
  try {
    res = await fetchWithTimeout(ultiproJobListUrl(parts), {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": BROWSER_USER_AGENT },
      // Measured 2026-09-23: this minimal body is accepted, and Skip pages
      // through the board — UltiPro takes no search text here.
      body: JSON.stringify({ opportunitySearch: { Top: PAGE_SIZE, Skip: skip } }),
    });
  } catch (thrown) {
    // The request itself never got a reply — same degraded-run case as an
    // error status, so the remaining boards still get their turn.
    return { warning: `ultipro board "${boardLabel}": ${messageFromThrown(thrown)}` };
  }
  if (!res.ok) {
    // A dead board is a degraded run, not a failed collector, so the
    // remaining boards still get their turn.
    return { warning: httpError(`ultipro board "${boardLabel}"`, res.status).message };
  }
  let body: UltiproJobListResponse;
  try {
    body = await safeJson<UltiproJobListResponse>(res, `ultipro board "${boardLabel}"`);
  } catch (thrown) {
    // safeJson's own message already names the board, so it is used as-is.
    return { warning: messageFromThrown(thrown) };
  }
  return { opportunities: body.opportunities ?? [] };
}

export const ultiproCollector: Collector = {
  name: "ultipro",

  async collect({ settings, atsSlugs, limit }): Promise<CollectorResult> {
    const { boards, warnings } = await readAtsBoards(atsSlugs, COLLECTOR);
    if (boards.length === 0) {
      return { jobs: [], errors: [], warnings };
    }

    const searchTerms = await settings.getSearchTerms();
    const jobs: JobListEntry[] = [];

    for (const board of boards) {
      if (jobs.length >= limit) break;

      const parts = partsFromUltiproBoard(board.ats_slug);
      if (!parts) {
        warnings.push(`ultipro board "${board.ats_slug}" is not a company code and board id`);
        continue;
      }

      // UltiPro takes no search text, so the whole board is walked once, in
      // pages, rather than once per search term.
      let skip = 0;
      for (;;) {
        const page = await fetchUltiproPage(parts, skip, board.ats_slug);
        if ("warning" in page) {
          warnings.push(page.warning);
          break;
        }

        for (const opportunity of page.opportunities) {
          if (jobs.length >= limit) break;
          if (matchesSearchTerms(opportunity.Title, searchTerms)) {
            jobs.push(toJobListEntry(opportunity, parts, board.ats_slug));
          }
        }

        // Fewer jobs than a full page means this reply was the last page.
        if (page.opportunities.length < PAGE_SIZE || jobs.length >= limit) break;
        skip += PAGE_SIZE;
      }
    }

    return { jobs, errors: [], warnings };
  },
};
