// Polls every promoted Workable board for jobs whose title matches the user's
// search terms. Workable's widget hands back a board's whole job list in one
// reply, so there is no paging. Unlike Gem, the widget names the employer, and
// it is the only Workable reply that does, so a job records that name as well
// as the slug of the board it came from.
import type { JobListEntry } from "../types/job-list-entry";
import {
  jobFieldsFromWorkableListing,
  type WorkableListing,
  type WorkableWidget,
} from "../utils/workable-fields";
import { matchesSearchTerms } from "../utils/search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { messageFromThrown } from "../utils/thrown-message";
import type { Collector, CollectorResult } from "./collector";

// The collector's own name, which is what a slug row carries when its board
// is on this collector's polling list.
const COLLECTOR = "workable";

const widgetUrl = (slug: string) => `https://apply.workable.com/api/v1/widget/accounts/${slug}`;

// The link and the phase gates are the collector's own: a Workable listing is
// already the source posting, so it needs no resolving. Its description still
// has to be read, which is a parser's job. The link is built rather than taken
// from the listing, because the listing's own link leaves out the board that a
// later read of the posting needs. The employer name comes from the widget and
// is only set when the widget carries one. Everything else comes from the
// shared mapper, so the collector and the parser cannot disagree about what a
// posting's fields mean.
function toJobListEntry(listing: WorkableListing, slug: string, companyName?: string): JobListEntry {
  const url = `https://apply.workable.com/${slug}/j/${listing.shortcode}`;
  return {
    original_url: url,
    resolved_url: url,
    ...jobFieldsFromWorkableListing(listing, slug),
    ...(companyName ? { raw_company_name: companyName } : {}),
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

export const workableCollector: Collector = {
  name: "workable",

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
        res = await fetchWithTimeout(widgetUrl(board.ats_slug));
      } catch (thrown) {
        // The request itself never got a reply — same degraded-run case as
        // an error status, so the remaining boards still get their turn.
        warnings.push(`workable board "${board.ats_slug}": ${messageFromThrown(thrown)}`);
        continue;
      }

      if (!res.ok) {
        // A dead board is a degraded run, not a failed collector, so the
        // remaining boards still get their turn.
        warnings.push(httpError(`workable board "${board.ats_slug}"`, res.status).message);
        continue;
      }

      let widget: WorkableWidget;
      try {
        widget = await safeJson<WorkableWidget>(res, `workable board "${board.ats_slug}"`);
      } catch (thrown) {
        // safeJson's own message already names the board, so it is used as-is.
        warnings.push(messageFromThrown(thrown));
        continue;
      }

      // Matched on the title alone. A listing's location never decides a match.
      const matched = widget.jobs.filter((listing) =>
        matchesSearchTerms(listing.title, searchTerms),
      );

      for (const listing of matched) {
        if (jobs.length >= limit) break;
        jobs.push(toJobListEntry(listing, board.ats_slug, widget.name));
      }
    }

    return { jobs, errors: [], warnings };
  },
};
