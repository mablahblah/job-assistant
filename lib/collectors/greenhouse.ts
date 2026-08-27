// Polls Greenhouse's public boards API for postings whose title matches the
// user's search terms, resolving each board's real employer name once per run
// rather than once per posting.
import type { JobListEntry } from "../job-list-entry";
import { normalizeSalary } from "../salary";
import { matchesSearchTerms } from "../search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { resolveAtsCompanyName } from "./ats-company-name";
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

function toJobListEntry(
  posting: GreenhousePosting,
  slug: string,
  companyName: string
): JobListEntry {
  // An ATS listing is already the source posting, so it needs no resolving
  // and no parsing.
  const url = `https://boards.greenhouse.io/${slug}/jobs/${posting.id}`;
  // Greenhouse sends cents, not whole dollars. That is a Greenhouse fact, so
  // the division happens here rather than inside the shared salary util. A
  // board with no range at all and one with an empty range both mean no pay.
  const range = posting.pay_input_ranges?.[0];
  const salary = normalizeSalary({
    low: range ? range.min_cents / 100 : undefined,
    high: range ? range.max_cents / 100 : undefined,
    currency: range?.currency_type,
  });
  return {
    original_url: url,
    resolved_url: url,
    original_title: posting.title,
    company_name: companyName,
    posting_date: new Date(posting.first_published),
    posting_updated_date: new Date(posting.updated_at),
    original_location_list: posting.location ? [posting.location.name] : [],
    // Greenhouse has no structured work-mode field, and reading one out of
    // the description text is a parser's job.
    original_mode_list: [],
    // A blank description is the same as none, so it is left unset.
    description: posting.content || undefined,
    ...salary,
    is_resolved: true,
    is_parsed: true,
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
      const matched = body.jobs.filter((posting) =>
        matchesSearchTerms(posting.title, searchTerms)
      );
      if (matched.length === 0) continue;

      // Every posting carries the employer's real name, so the name costs no
      // request of its own. It matches the board endpoint's name exactly, and
      // that endpoint is the one that intermittently times out.
      const { name: companyName, warnings: nameWarnings } = await resolveAtsCompanyName(
        PLATFORM,
        board.ats_slug,
        async () => matched[0]?.company_name ?? null
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
