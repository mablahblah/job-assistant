// Polls Ashby's public job board API for jobs whose title matches the user's
// search terms. Ashby's API carries no employer name, so a job records the
// slug of the board it came from and leaves the name to company association.
import {
  jobFieldsFromAshbyPosting,
  type AshbyJobBoardResponse,
  type AshbyPosting,
} from "../utils/ashby-fields";
import type { JobListEntry } from "../types/job-list-entry";
import { matchesSearchTerms } from "../utils/search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { messageFromThrown } from "../utils/thrown-message";
import type { Collector, CollectorResult } from "./collector";

// The collector's own name, which is what a slug row carries when its board
// is on this collector's polling list.
const COLLECTOR = "ashby";

const jobBoardUrl = (slug: string) =>
  `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;

// The link and the phase gates are the collector's own: an Ashby listing is
// already the source posting, so it needs no resolving, and Ashby supplies the
// posting's own URL rather than making it be rebuilt from slug and id. The
// description still has to be read, which is a parser's job. Everything else
// comes from the shared mapper, so the collector and the parser cannot
// disagree about what a posting's fields mean.
function toJobListEntry(posting: AshbyPosting, slug: string): JobListEntry {
  const url = posting.jobUrl;
  return {
    original_url: url,
    resolved_url: url,
    ...jobFieldsFromAshbyPosting(posting, slug),
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

export const ashbyCollector: Collector = {
  name: "ashby",

  async collect({ settings, atsSlugs, limit }): Promise<CollectorResult> {
    const { boards, warnings } = await readAtsBoards(atsSlugs, COLLECTOR);
    if (boards.length === 0) {
      return { jobs: [], errors: [], warnings };
    }

    const searchTerms = await settings.getSearchTerms();
    const jobs: JobListEntry[] = [];

    for (const board of boards) {
      if (jobs.length >= limit) break;

      let res: Response;
      try {
        res = await fetchWithTimeout(jobBoardUrl(board.ats_slug));
      } catch (thrown) {
        // The request itself never got a reply — same degraded-run case as
        // an error status, so the remaining boards still get their turn.
        warnings.push(`ashby board "${board.ats_slug}": ${messageFromThrown(thrown)}`);
        continue;
      }

      if (!res.ok) {
        // A dead board is a degraded run, not a failed collector, so the
        // remaining boards still get their turn.
        warnings.push(httpError(`ashby board "${board.ats_slug}"`, res.status).message);
        continue;
      }

      let body: AshbyJobBoardResponse;
      try {
        body = await safeJson<AshbyJobBoardResponse>(res, `ashby board "${board.ats_slug}"`);
      } catch (thrown) {
        // safeJson's own message already names the board, so it is used as-is.
        warnings.push(messageFromThrown(thrown));
        continue;
      }

      // Unlisted postings go first, because a draft or archived role is not
      // something anyone can apply to. What survives is matched on the title
      // alone — a posting's department or team never decides a match.
      const matched = body.jobs.filter(
        (posting) => posting.isListed && matchesSearchTerms(posting.title, searchTerms)
      );

      for (const posting of matched) {
        if (jobs.length >= limit) break;
        jobs.push(toJobListEntry(posting, board.ats_slug));
      }
    }

    return { jobs, errors: [], warnings };
  },
};
