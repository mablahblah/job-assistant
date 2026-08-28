// Polls Lever's public postings API for jobs whose title matches the user's
// search terms. Lever's API carries no employer name, so a job records the
// slug of the board it came from and leaves the name to company association.
import type { JobListEntry } from "../job-list-entry";
import { matchesSearchTerms } from "../search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "./fetch-utils";
import type { Collector, CollectorResult } from "./types";

const PLATFORM = "lever";

const postingsUrl = (slug: string) => `https://api.lever.co/v0/postings/${slug}?mode=json`;

interface LeverPosting {
  id: string;
  text: string;
  createdAt: number;
  categories?: { location?: string; team?: string };
  workplaceType?: string;
  descriptionPlain?: string;
  description?: string;
}

function toJobListEntry(posting: LeverPosting, slug: string): JobListEntry {
  // An ATS listing is already the source posting, so it needs no resolving.
  // Its description still has to be read, which is a parser's job.
  const url = `https://jobs.lever.co/${slug}/${posting.id}`;
  // The plain-text field wins over the HTML one when both are present, and a
  // blank one counts as none.
  const description = posting.descriptionPlain || posting.description || undefined;
  return {
    original_url: url,
    resolved_url: url,
    raw_title: posting.text,
    // The slug is the only employer identity this API supplies, and it is the
    // stronger one anyway: company association looks a company up by slug
    // before it falls back to a name.
    raw_company_slug: slug,
    // Lever publishes one date, so nothing fills posting_updated_date.
    posting_date: new Date(posting.createdAt),
    raw_location_list: posting.categories?.location ? [posting.categories.location] : [],
    // Stored exactly as Lever sends it — remote, hybrid, or onsite. Mapping
    // those words onto the three the app uses is normalization's job, and a
    // posting without the field leaves the list empty for a parser to fill.
    raw_mode_list: posting.workplaceType ? [posting.workplaceType] : [],
    description,
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

export const leverCollector: Collector = {
  name: "lever",

  async collect({ settings, limit }): Promise<CollectorResult> {
    const { boards, warnings } = await readAtsBoards(settings, PLATFORM);
    if (boards.length === 0) {
      return { jobs: [], errors: [], warnings };
    }

    const searchTerms = await settings.getSearchTerms();
    const jobs: JobListEntry[] = [];

    for (const board of boards) {
      if (jobs.length >= limit) break;

      const res = await fetchWithTimeout(postingsUrl(board.ats_slug));
      if (!res.ok) {
        // A dead board is a degraded run, not a failed collector, so the
        // remaining boards still get their turn.
        warnings.push(httpError(`lever board "${board.ats_slug}"`, res.status).message);
        continue;
      }

      const postings = await safeJson<LeverPosting[]>(res, `lever board "${board.ats_slug}"`);
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
