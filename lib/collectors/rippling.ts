// Polls every promoted Rippling board for jobs whose title matches the user's
// search terms. Rippling hands back a board's whole job list in one reply, so
// there is no paging. Unlike Gem, a Rippling listing names no employer — that
// lives on the job's detail page, so the parser fills the name.
import type { JobListEntry } from "../types/job-list-entry";
import { jobFieldsFromRipplingJob, type RipplingJob } from "../utils/rippling-fields";
import { matchesSearchTerms } from "../utils/search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { messageFromThrown } from "../utils/thrown-message";
import type { Collector, CollectorResult } from "./collector";

// The collector's own name, which is what a slug row carries when its board
// is on this collector's polling list.
const COLLECTOR = "rippling";

// The address Rippling's own board page calls (measured 2026-09-24).
const boardJobsUrl = (slug: string) =>
  `https://api.rippling.com/platform/api/ats/v1/board/${slug}/jobs`;

// The link is the collector's own: it is built from the board slug and the
// job's uuid, not read off the reply, and it is already the source posting,
// so it needs no resolving. Everything else comes from the shared mapper, so
// the collector and the parser cannot disagree about what a posting's fields
// mean.
function toJobListEntry(job: RipplingJob, slug: string): JobListEntry {
  const url = `https://ats.rippling.com/${slug}/jobs/${job.uuid}`;
  return {
    original_url: url,
    resolved_url: url,
    ...jobFieldsFromRipplingJob(job, slug),
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

export const ripplingCollector: Collector = {
  name: "rippling",

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
        res = await fetchWithTimeout(boardJobsUrl(board.ats_slug));
      } catch (thrown) {
        // The request itself never got a reply — same degraded-run case as
        // an error status, so the remaining boards still get their turn.
        warnings.push(`rippling board "${board.ats_slug}": ${messageFromThrown(thrown)}`);
        continue;
      }

      if (!res.ok) {
        // A dead board is a degraded run, not a failed collector, so the
        // remaining boards still get their turn.
        warnings.push(httpError(`rippling board "${board.ats_slug}"`, res.status).message);
        continue;
      }

      let listings: RipplingJob[];
      try {
        listings = await safeJson<RipplingJob[]>(res, `rippling board "${board.ats_slug}"`);
      } catch (thrown) {
        // safeJson's own message already names the board, so it is used as-is.
        warnings.push(messageFromThrown(thrown));
        continue;
      }

      // Matched on the title alone. A posting's location never decides a match.
      const matched = listings.filter((job) => matchesSearchTerms(job.name, searchTerms));

      for (const job of matched) {
        if (jobs.length >= limit) break;
        jobs.push(toJobListEntry(job, board.ats_slug));
      }
    }

    return { jobs, errors: [], warnings };
  },
};
