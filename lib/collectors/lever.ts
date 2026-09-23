// Polls Lever's public postings API for jobs whose title matches the user's
// search terms. Lever's API carries no employer name, so a job records the
// slug of the board it came from and leaves the name to company association.
import type { JobListEntry } from "../types/job-list-entry";
import { jobFieldsFromLeverPosting, type LeverPosting } from "../utils/lever-fields";
import { matchesSearchTerms } from "../utils/search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { messageFromThrown } from "../utils/thrown-message";
import type { Collector, CollectorResult } from "./collector";

// The collector's own name, which is what a slug row carries when its board
// is on this collector's polling list.
const COLLECTOR = "lever";

const postingsUrl = (slug: string) => `https://api.lever.co/v0/postings/${slug}?mode=json`;

// The link and the phase gates are the collector's own: a Lever listing is
// already the source posting, so it needs no resolving. Its description still
// has to be read, which is a parser's job. Everything else comes from the
// shared mapper, so the collector and the parser cannot disagree about what a
// posting's fields mean.
function toJobListEntry(posting: LeverPosting, slug: string): JobListEntry {
  const url = `https://jobs.lever.co/${slug}/${posting.id}`;
  return {
    original_url: url,
    resolved_url: url,
    ...jobFieldsFromLeverPosting(posting, slug),
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

export const leverCollector: Collector = {
  name: "lever",

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
        res = await fetchWithTimeout(postingsUrl(board.ats_slug));
      } catch (thrown) {
        // The request itself never got a reply — same degraded-run case as
        // an error status, so the remaining boards still get their turn.
        warnings.push(`lever board "${board.ats_slug}": ${messageFromThrown(thrown)}`);
        continue;
      }

      if (!res.ok) {
        // A dead board is a degraded run, not a failed collector, so the
        // remaining boards still get their turn.
        warnings.push(httpError(`lever board "${board.ats_slug}"`, res.status).message);
        continue;
      }

      let postings: LeverPosting[];
      try {
        postings = await safeJson<LeverPosting[]>(res, `lever board "${board.ats_slug}"`);
      } catch (thrown) {
        // safeJson's own message already names the board, so it is used as-is.
        warnings.push(messageFromThrown(thrown));
        continue;
      }

      // Matched on the title alone. A posting's team never decides a match.
      const matched = postings.filter((posting) => matchesSearchTerms(posting.text, searchTerms));

      for (const posting of matched) {
        if (jobs.length >= limit) break;
        jobs.push(toJobListEntry(posting, board.ats_slug));
      }
    }

    return { jobs, errors: [], warnings };
  },
};
