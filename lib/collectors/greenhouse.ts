// Polls Greenhouse's public boards API for postings whose title matches the
// user's search terms.
import {
  jobFieldsFromGreenhousePosting,
  type GreenhouseJobsResponse,
  type GreenhousePosting,
} from "../greenhouse-fields";
import type { JobListEntry } from "../job-list-entry";
import { matchesSearchTerms } from "../search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "./fetch-utils";
import type { Collector, CollectorResult } from "./types";

const PLATFORM = "greenhouse";

const jobsUrl = (slug: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true&pay_transparency=true`;

// The link and the phase gates are the collector's own: a Greenhouse listing
// is already the source posting, so it needs no resolving. Its description
// still has to be read, which is a parser's job. Everything else comes from
// the shared mapper, so the collector and the parser cannot disagree about
// what a posting's fields mean.
function toJobListEntry(posting: GreenhousePosting, slug: string): JobListEntry {
  const url = `https://boards.greenhouse.io/${slug}/jobs/${posting.id}`;
  return {
    original_url: url,
    resolved_url: url,
    ...jobFieldsFromGreenhousePosting(posting, slug),
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

export const greenhouseCollector: Collector = {
  name: "greenhouse",

  async collect({ settings, limit }): Promise<CollectorResult> {
    const { boards, warnings } = await readAtsBoards(settings, PLATFORM);
    if (boards.length === 0) {
      return { jobs: [], errors: [], warnings };
    }

    const searchTerms = await settings.getSearchTerms();
    const jobs: JobListEntry[] = [];

    for (const board of boards) {
      if (jobs.length >= limit) break;

      const res = await fetchWithTimeout(jobsUrl(board.ats_slug));
      if (!res.ok) {
        // A dead board is a degraded run, not a failed collector, so the
        // remaining boards still get their turn.
        warnings.push(httpError(`greenhouse board "${board.ats_slug}"`, res.status).message);
        continue;
      }

      const body = await safeJson<GreenhouseJobsResponse>(
        res,
        `greenhouse board "${board.ats_slug}"`
      );
      // The board endpoint accepts no query, so the terms are applied here.
      const matched = body.jobs.filter((posting) => matchesSearchTerms(posting.title, searchTerms));

      for (const posting of matched) {
        if (jobs.length >= limit) break;
        jobs.push(toJobListEntry(posting, board.ats_slug));
      }
    }

    return { jobs, errors: [], warnings };
  },
};
