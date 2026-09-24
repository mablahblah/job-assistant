// Polls every promoted BambooHR board for jobs whose title matches the
// user's search terms. A board hands back its whole job list in one reply,
// so there is no paging. A careers page answers with a web page unless asked
// for data, so the request states its accept header explicitly.
import type { JobListEntry } from "../types/job-list-entry";
import {
  jobFieldsFromBambooHrJob,
  type BambooHrJob,
  type BambooHrListResponse,
} from "../utils/bamboohr-fields";
import { matchesSearchTerms } from "../utils/search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { messageFromThrown } from "../utils/thrown-message";
import type { Collector, CollectorResult } from "./collector";

// The collector's own name, which is what a slug row carries when its board
// is on this collector's polling list.
const COLLECTOR = "bamboohr";

const careersListUrl = (slug: string) => `https://${slug}.bamboohr.com/careers/list`;

// The link and the phase gates are the collector's own: a BambooHR listing
// is already the source posting, so it needs no resolving. Its description
// still has to be read, which is a parser's job. Everything else comes from
// the shared mapper, so the collector and the parser cannot disagree about
// what a posting's fields mean.
function toJobListEntry(job: BambooHrJob, slug: string): JobListEntry {
  // The type leaves `id` optional for other BambooHR endpoints, but a
  // careers-list entry always has one.
  const url = `https://${slug}.bamboohr.com/careers/${job.id}`;
  return {
    original_url: url,
    resolved_url: url,
    ...jobFieldsFromBambooHrJob(job, slug),
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

export const bamboohrCollector: Collector = {
  name: "bamboohr",

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
        res = await fetchWithTimeout(careersListUrl(board.ats_slug), {
          headers: { accept: "application/json" },
        });
      } catch (thrown) {
        // The request itself never got a reply — same degraded-run case as
        // an error status, so the remaining boards still get their turn.
        warnings.push(`bamboohr board "${board.ats_slug}": ${messageFromThrown(thrown)}`);
        continue;
      }

      if (!res.ok) {
        // A dead board is a degraded run, not a failed collector, so the
        // remaining boards still get their turn.
        warnings.push(httpError(`bamboohr board "${board.ats_slug}"`, res.status).message);
        continue;
      }

      let payload: BambooHrListResponse;
      try {
        payload = await safeJson<BambooHrListResponse>(res, `bamboohr board "${board.ats_slug}"`);
      } catch (thrown) {
        // safeJson's own message already names the board, so it is used as-is.
        warnings.push(messageFromThrown(thrown));
        continue;
      }

      // Matched on the title alone. A posting's location never decides a match.
      const matched = payload.result.filter((job) =>
        matchesSearchTerms(job.jobOpeningName, searchTerms),
      );

      for (const job of matched) {
        if (jobs.length >= limit) break;
        jobs.push(toJobListEntry(job, board.ats_slug));
      }
    }

    return { jobs, errors: [], warnings };
  },
};
