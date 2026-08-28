// Polls Ashby's public job board API for jobs whose title matches the user's
// search terms. Ashby's API carries no employer name, so a job records the
// slug of the board it came from and leaves the name to company association.
import type { JobListEntry, RawSalary } from "../job-list-entry";
import { matchesSearchTerms } from "../search-term-analyzer";
import { readAtsBoards } from "./ats-boards";
import { fetchWithTimeout, httpError, safeJson } from "./fetch-utils";
import type { Collector, CollectorResult } from "./types";

const PLATFORM = "ashby";

const jobBoardUrl = (slug: string) =>
  `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;

interface AshbySecondaryLocation {
  location?: string;
}

interface AshbyCompensationComponent {
  compensationType: string;
  interval?: string | null;
  currencyCode?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
}

interface AshbyPosting {
  title: string;
  isListed: boolean;
  jobUrl: string;
  publishedAt: string;
  location?: string;
  secondaryLocations?: AshbySecondaryLocation[];
  workplaceType?: string | null;
  descriptionPlain?: string;
  descriptionHtml?: string;
  compensation?: {
    summaryComponents?: AshbyCompensationComponent[];
  };
}

interface AshbyJobBoardResponse {
  jobs: AshbyPosting[];
}

function toJobListEntry(posting: AshbyPosting, slug: string): JobListEntry {
  // An ATS listing is already the source posting, so it needs no resolving.
  // Ashby supplies the posting's own URL, so it is used rather than rebuilt
  // from slug and id. The description still has to be read, which is a
  // parser's job.
  const url = posting.jobUrl;

  // The plain-text field wins over the HTML one when both are present, and a
  // blank one counts as none.
  const description = posting.descriptionPlain || posting.descriptionHtml || undefined;

  // The primary location first, then any secondary ones, all kept. Blanks are
  // dropped rather than stored as empty entries.
  const raw_location_list = [
    posting.location,
    ...(posting.secondaryLocations?.map((secondary) => secondary.location) ?? []),
  ].filter((location): location is string => Boolean(location));

  // Stored exactly as Ashby sends it — Remote, Hybrid, or OnSite. Mapping
  // those words onto the three the app uses is normalization's job, and a
  // posting without the field leaves the list empty for a parser to fill.
  // The isRemote flag is deliberately not read: it is true on hybrid postings
  // anchored to an office, so it contradicts workplaceType.
  const raw_mode_list = posting.workplaceType ? [posting.workplaceType] : [];

  // summaryComponents mixes salary, equity, commission, and bonus entries in
  // no fixed order — equity is frequently first, carrying null values — so the
  // salary is picked out by type rather than taken as the first entry. The
  // interval and the currency are recorded as sent, because a source's own
  // words about its own pay are what the raw fields are for. No salary_unit,
  // since Ashby sends whole currency units rather than cents.
  const salaryComponent = posting.compensation?.summaryComponents?.find(
    (component) => component.compensationType === "Salary"
  );
  const raw_salary: RawSalary | undefined = salaryComponent
    ? {
        salary_min: salaryComponent.minValue ?? undefined,
        salary_max: salaryComponent.maxValue ?? undefined,
        salary_period: salaryComponent.interval ?? undefined,
        salary_currency: salaryComponent.currencyCode ?? undefined,
      }
    : undefined;

  return {
    original_url: url,
    resolved_url: url,
    raw_title: posting.title,
    // The slug is the only employer identity this API supplies, and it is the
    // stronger one anyway: company association looks a company up by slug
    // before it falls back to a name.
    raw_company_slug: slug,
    // Ashby publishes one date, so nothing fills posting_updated_date.
    posting_date: new Date(posting.publishedAt),
    raw_location_list,
    raw_mode_list,
    description,
    ...(raw_salary ? { raw_salary } : {}),
    is_resolved: true,
    is_parsed: false,
    is_classified: false,
  };
}

export const ashbyCollector: Collector = {
  name: "ashby",

  async collect({ settings, limit }): Promise<CollectorResult> {
    const { boards, warnings } = await readAtsBoards(settings, PLATFORM);
    if (boards.length === 0) {
      return { jobs: [], errors: [], warnings };
    }

    const searchTerms = await settings.getSearchTerms();
    const jobs: JobListEntry[] = [];

    for (const board of boards) {
      if (jobs.length >= limit) break;

      const res = await fetchWithTimeout(jobBoardUrl(board.ats_slug));
      if (!res.ok) {
        // A dead board is a degraded run, not a failed collector, so the
        // remaining boards still get their turn.
        warnings.push(httpError(`ashby board "${board.ats_slug}"`, res.status).message);
        continue;
      }

      const body = await safeJson<AshbyJobBoardResponse>(res, `ashby board "${board.ats_slug}"`);
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
