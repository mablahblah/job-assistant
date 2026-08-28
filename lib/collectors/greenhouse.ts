// Polls Greenhouse's public boards API for postings whose title matches the
// user's search terms.
import type { JobListEntry, RawSalary } from "../job-list-entry";
import { matchesSearchTerms } from "../search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "./fetch-utils";
import type { Collector, CollectorResult } from "./types";

const PLATFORM = "greenhouse";

const jobsUrl = (slug: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true&pay_transparency=true`;

interface GreenhousePayRange {
  min_cents: number;
  max_cents: number;
  currency_type: string;
}

interface GreenhousePosting {
  id: number;
  title: string;
  first_published: string;
  updated_at: string;
  location?: { name: string };
  content?: string;
  pay_input_ranges?: GreenhousePayRange[];
  company_name?: string;
}

interface GreenhouseJobsResponse {
  jobs: GreenhousePosting[];
}

function toJobListEntry(posting: GreenhousePosting, slug: string): JobListEntry {
  // An ATS listing is already the source posting, so it needs no resolving.
  // Its description still has to be read, which is a parser's job.
  const url = `https://boards.greenhouse.io/${slug}/jobs/${posting.id}`;
  // A blank description is the same as none, so it is left unset.
  const description = posting.content || undefined;
  // Greenhouse sends cents, and the cents are written exactly as sent. No
  // figure carries its unit on its face, so which unit an API sends is a fact
  // the collector records rather than acts on. A board with no range at all
  // and one with an empty range both mean no pay, and neither writes a salary.
  const range = posting.pay_input_ranges?.[0];
  const raw_salary: RawSalary | undefined = range
    ? {
        salary_min: range.min_cents,
        salary_max: range.max_cents,
        salary_currency: range.currency_type,
        salary_unit: "cents",
      }
    : undefined;
  return {
    original_url: url,
    resolved_url: url,
    raw_title: posting.title,
    // Every posting carries the employer's real name, so it is read straight
    // off the posting and costs no request of its own. A posting without one
    // leaves this empty rather than standing a name in for it.
    raw_company_name: posting.company_name,
    // Recorded beside the name because a slug is the stronger identity, and
    // company association looks a company up by slug first.
    raw_company_slug: slug,
    posting_date: new Date(posting.first_published),
    posting_updated_date: new Date(posting.updated_at),
    raw_location_list: posting.location ? [posting.location.name] : [],
    // Greenhouse publishes no work-mode field, so there is nothing to collect.
    // The mode is in the description, and reading it out is a parser's job.
    raw_mode_list: [],
    description,
    ...(raw_salary ? { raw_salary } : {}),
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
