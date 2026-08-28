// Polls Adzuna's search API for jobs matching the user's search terms. Each
// term runs two searches — one nationwide for remote work, one anchored to the
// user's location — because carrying a location into the remote search would
// narrow it to the radius and defeat it.
import type { JobListEntry, RawSalary } from "../job-list-entry";
import { fetchWithTimeout, httpError, safeJson } from "./fetch-utils";
import type { Collector, CollectorResult } from "./types";

const SEARCH_URL = "https://api.adzuna.com/v1/api/jobs/us/search/1";

interface AdzunaJob {
  id: string;
  title: string;
  company: { display_name: string };
  redirect_url: string;
  location?: { display_name: string };
  created: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string;
}

interface AdzunaSearchResponse {
  results: AdzunaJob[] | null;
  count: number;
}

function toJobListEntry(job: AdzunaJob): JobListEntry {
  // Salary is read only where salary_is_predicted is "0". Adzuna's model
  // outputs "1" for a guess, measured at 133 of 150 results, and a guess reads
  // as fact once stored. Adzuna states no period and no currency and sends
  // whole dollars, so those three keys never appear.
  const raw_salary: RawSalary = {};
  if (job.salary_is_predicted === "0") {
    if (job.salary_min !== undefined) raw_salary.salary_min = job.salary_min;
    if (job.salary_max !== undefined) raw_salary.salary_max = job.salary_max;
  }
  // A period or a currency on its own is not a salary, so the envelope is
  // written only where a figure is there to carry it.
  const hasFigures = raw_salary.salary_min !== undefined || raw_salary.salary_max !== undefined;

  // An aggregator link is a redirect rather than the source posting, so it is
  // neither resolved nor parsed yet.
  return {
    original_url: job.redirect_url,
    raw_title: job.title,
    raw_company_name: job.company.display_name,
    // Adzuna publishes one date, so nothing fills posting_updated_date.
    posting_date: new Date(job.created),
    raw_location_list: job.location ? [job.location.display_name] : [],
    // Adzuna publishes no structured work mode, and reading one out of the
    // description text is a parser's job.
    raw_mode_list: [],
    // Adzuna truncates its descriptions to 500 characters. The collector keeps
    // whatever it was sent, and a blank one counts as none.
    description: job.description || undefined,
    ...(hasFigures ? { raw_salary } : {}),
    is_resolved: false,
    is_parsed: false,
    is_classified: false,
  };
}

// Runs one search and adds its results to the shared list, stopping as soon as
// the limit is reached partway through a page.
async function runSearch(
  params: URLSearchParams,
  jobs: JobListEntry[],
  limit: number,
  warnings: string[],
  label: string
): Promise<void> {
  const res = await fetchWithTimeout(`${SEARCH_URL}?${params.toString()}`);
  if (!res.ok) {
    warnings.push(httpError(label, res.status).message);
    return;
  }
  const body = await safeJson<AdzunaSearchResponse>(res, label);
  for (const job of body.results ?? []) {
    if (jobs.length >= limit) break;
    jobs.push(toJobListEntry(job));
  }
}

export const adzunaCollector: Collector = {
  name: "adzuna",

  async collect({ settings, limit }): Promise<CollectorResult> {
    const appId = process.env.ADZUNA_APP_ID;
    const apiKey = process.env.ADZUNA_API_KEY;
    if (!appId || !apiKey) {
      return {
        jobs: [],
        errors: ["Adzuna needs ADZUNA_APP_ID and ADZUNA_API_KEY in the environment."],
        warnings: [],
      };
    }

    const searchTerms = await settings.getSearchTerms();
    const location = await settings.getLocation();
    const radius = await settings.getRadius();
    const expiryThreshold = await settings.getExpiryThreshold();

    const jobs: JobListEntry[] = [];
    const warnings: string[] = [];

    for (const term of searchTerms) {
      if (jobs.length >= limit) break;

      const sharedParams = {
        app_id: appId,
        app_key: apiKey,
        title_only: term,
        max_days_old: String(expiryThreshold),
        salary_min: "100000",
        salary_include_unknown: "1",
        sort_by: "date",
        results_per_page: "50",
        "content-type": "application/json",
      };

      // No where and no distance, so this search stays nationwide.
      await runSearch(
        new URLSearchParams({ ...sharedParams, what: "remote" }),
        jobs,
        limit,
        warnings,
        `Adzuna remote search "${term}"`
      );

      if (jobs.length >= limit) break;

      await runSearch(
        new URLSearchParams({
          ...sharedParams,
          where: location,
          // Miles, measured against the live API from zip 78701: San Antonio
          // at 80 miles away first appears at distance=80.
          distance: String(radius),
        }),
        jobs,
        limit,
        warnings,
        `Adzuna Austin search "${term}"`
      );
    }

    return { jobs, errors: [], warnings };
  },
};
