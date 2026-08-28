// Polls Lever's public postings API for jobs whose title matches the user's
// search terms, resolving each board's real employer name once per run rather
// than once per posting.
import type { JobListEntry } from "../job-list-entry";
import { matchesSearchTerms } from "../search-term-analyzer";
import { readWorkModeFromText } from "../work-mode";
import { readAtsBoards } from "./ats-boards";
import { nameFromBoardTitle, resolveAtsCompanyName, titleFromHtml } from "./ats-company-name";
import { fetchWithTimeout, httpError, safeJson } from "./fetch-utils";
import type { Collector, CollectorResult } from "./types";

const PLATFORM = "lever";

const postingsUrl = (slug: string) => `https://api.lever.co/v0/postings/${slug}?mode=json`;

const boardPageUrl = (slug: string) => `https://jobs.lever.co/${slug}`;

interface LeverPosting {
  id: string;
  text: string;
  createdAt: number;
  categories?: { location?: string; team?: string };
  workplaceType?: string;
  descriptionPlain?: string;
  description?: string;
}

// Lever's API carries no employer name, so the board page's title is the only
// source. A page that will not answer throws, so the shared resolver records
// why before falling back.
async function lookUpCompanyName(slug: string): Promise<string | null> {
  const res = await fetchWithTimeout(boardPageUrl(slug));
  if (!res.ok) {
    throw httpError(`lever board "${slug}"`, res.status);
  }
  const title = titleFromHtml(await res.text());
  return title === null ? null : nameFromBoardTitle(title);
}

function toJobListEntry(posting: LeverPosting, slug: string, companyName: string): JobListEntry {
  // An ATS listing is already the source posting, so it needs no resolving.
  // Its description still has to be read, which is a parser's job.
  const url = `https://jobs.lever.co/${slug}/${posting.id}`;
  // The plain-text field wins over the HTML one when both are present, and a
  // blank one counts as none.
  const description = posting.descriptionPlain || posting.description || undefined;
  // Lever's own field wins where it publishes one. Only a posting without it
  // falls back to reading a mode out of the description.
  const mode =
    posting.workplaceType || (description ? readWorkModeFromText(description) : undefined);
  return {
    original_url: url,
    resolved_url: url,
    raw_title: posting.text,
    raw_company_name: companyName,
    // Lever publishes one date, so nothing fills posting_updated_date.
    posting_date: new Date(posting.createdAt),
    raw_location_list: posting.categories?.location ? [posting.categories.location] : [],
    raw_mode_list: mode ? [mode] : [],
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
      if (matched.length === 0) continue;

      // Asked once per board, however many of its postings matched.
      const { name: companyName, warnings: nameWarnings } = await resolveAtsCompanyName(
        PLATFORM,
        board.ats_slug,
        () => lookUpCompanyName(board.ats_slug)
      );
      warnings.push(...nameWarnings);

      for (const posting of matched) {
        if (jobs.length >= limit) break;
        jobs.push(toJobListEntry(posting, board.ats_slug, companyName));
      }
    }

    return { jobs, errors: [], warnings };
  },
};
