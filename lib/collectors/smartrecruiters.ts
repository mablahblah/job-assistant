// Polls every promoted SmartRecruiters board for jobs whose title matches
// the user's search terms, reading a board through every page it has.
// SmartRecruiters hands back a board's jobs 100 at a time; a page is read
// until it comes back empty or the pages read so far already reach the
// board's reported total, so a one-page or empty board is asked for once.
import type { JobListEntry } from "../types/job-list-entry";
import {
  jobFieldsFromSmartRecruitersPosting,
  type SmartRecruitersPosting,
  type SmartRecruitersPostingsResponse,
} from "../utils/smartrecruiters-fields";
import { matchesSearchTerms } from "../utils/search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { messageFromThrown } from "../utils/thrown-message";
import type { Collector, CollectorResult } from "./collector";

// The collector's own name, which is what a slug row carries when its board
// is on this collector's polling list.
const COLLECTOR = "smartrecruiters";

// The most postings SmartRecruiters hands back in one reply, measured
// 2026-09-24 against ServiceNow's board (686 postings, served 100 at a time).
const PAGE_SIZE = 100;

const postingsUrl = (slug: string, offset: number) =>
  `https://api.smartrecruiters.com/v1/companies/${slug}/postings?offset=${offset}&limit=${PAGE_SIZE}`;

// The link and the phase gates are the collector's own: a SmartRecruiters
// listing is already the source posting, so it needs no resolving. Its
// description still has to be read, which is a parser's job. Everything else
// comes from the shared mapper, so the collector and the parser cannot
// disagree about what a posting's fields mean.
function toJobListEntry(posting: SmartRecruitersPosting, slug: string): JobListEntry {
  const url = `https://jobs.smartrecruiters.com/${slug}/${posting.id}`;
  return {
    original_url: url,
    resolved_url: url,
    ...jobFieldsFromSmartRecruitersPosting(posting, slug),
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

// Reads one page of a board. A failure only costs that board: it comes back
// as a warning so the remaining boards still get their turn.
async function fetchPostingsPage(
  slug: string,
  offset: number,
): Promise<SmartRecruitersPostingsResponse | { warning: string }> {
  const label = `smartrecruiters board "${slug}"`;
  let res: Response;
  try {
    res = await fetchWithTimeout(postingsUrl(slug, offset));
  } catch (thrown) {
    // The request itself never got a reply — same degraded-run case as an
    // error status.
    return { warning: `${label}: ${messageFromThrown(thrown)}` };
  }

  if (!res.ok) {
    // A dead board is a degraded run, not a failed collector.
    return { warning: httpError(label, res.status).message };
  }

  try {
    return await safeJson<SmartRecruitersPostingsResponse>(res, label);
  } catch (thrown) {
    // safeJson's own message already names the board, so it is used as-is.
    return { warning: messageFromThrown(thrown) };
  }
}

export const smartrecruitersCollector: Collector = {
  name: "smartrecruiters",

  async collect({ settings, atsSlugs, limit }): Promise<CollectorResult> {
    const { boards, warnings } = await readAtsBoards(atsSlugs, COLLECTOR);
    if (boards.length === 0) {
      return { jobs: [], errors: [], warnings };
    }

    const searchTerms = await settings.getSearchTerms();
    const jobs: JobListEntry[] = [];

    for (const board of boards) {
      if (jobs.length >= limit) break;

      // A page is the last one when it comes back empty, or when what has
      // been read so far already reaches the board's reported total — so a
      // board of exactly one page, or none at all, is asked for only once.
      // Paging also stops once the limit is met, so no page is read that
      // could only be thrown away.
      let offset = 0;
      for (;;) {
        const page = await fetchPostingsPage(board.ats_slug, offset);
        if ("warning" in page) {
          // The pages already read keep their matches.
          warnings.push(page.warning);
          break;
        }

        // Matched on the title alone. A posting's location never decides a match.
        for (const posting of page.content) {
          if (jobs.length >= limit) break;
          if (matchesSearchTerms(posting.name, searchTerms)) {
            jobs.push(toJobListEntry(posting, board.ats_slug));
          }
        }

        const readSoFar = offset + page.content.length;
        if (page.content.length === 0 || readSoFar >= page.totalFound || jobs.length >= limit) break;
        offset += PAGE_SIZE;
      }
    }

    return { jobs, errors: [], warnings };
  },
};
