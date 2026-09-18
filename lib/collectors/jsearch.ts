// Polls JSearch, through RapidAPI, for jobs matching the user's search terms.
// Every term folds into one query, so a run is always two requests — one for
// remote work and one anchored to the user's location. Each is attempted on
// its own, so a failure in one never costs the other its jobs.
import type { JobListEntry, RawSalary } from "../types/job-list-entry";
import { messageFromThrown } from "../utils/thrown-message";
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import type { Collector, CollectorResult } from "./collector";

const SEARCH_URL = "https://jsearch.p.rapidapi.com/search";
const API_HOST = "jsearch.p.rapidapi.com";

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name: string;
  job_apply_link: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote: boolean;
  job_posted_at_datetime_utc?: string;
  job_description?: string;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_period?: string | null;
}

interface JSearchResponse {
  status: string;
  data: JSearchJob[] | null;
}

function toJobListEntry(job: JSearchJob): JobListEntry {
  // JSearch labels one location across three fields, so joining them assembles
  // what the source already called a single place rather than interpreting it.
  // Kept as one entry because the list means locations: split apart, "US"
  // would stand as a location of its own for the radius check to measure.
  const locationParts = [job.job_city, job.job_state, job.job_country].filter(
    (part): part is string => Boolean(part)
  );

  // JSearch answers a posting with no pay by sending null rather than leaving
  // the key off, so null and absent both mean the source said nothing.
  const raw_salary: RawSalary = {};
  if (job.job_min_salary !== null && job.job_min_salary !== undefined) {
    raw_salary.salary_min = job.job_min_salary;
  }
  if (job.job_max_salary !== null && job.job_max_salary !== undefined) {
    raw_salary.salary_max = job.job_max_salary;
  }
  if (job.job_salary_period !== null && job.job_salary_period !== undefined) {
    raw_salary.salary_period = job.job_salary_period;
  }
  // A period on its own is not a salary, so the envelope is written only where
  // a figure is there to carry it.
  const hasFigures = raw_salary.salary_min !== undefined || raw_salary.salary_max !== undefined;

  // An aggregator link is a redirect rather than the source posting, so it is
  // neither resolved nor parsed yet.
  return {
    original_url: job.job_apply_link,
    raw_title: job.job_title,
    raw_company_name: job.employer_name,
    // JSearch leaves this off some postings, and no date beats an invalid one.
    posting_date: job.job_posted_at_datetime_utc
      ? new Date(job.job_posted_at_datetime_utc)
      : undefined,
    raw_location_list: locationParts.length > 0 ? [locationParts.join(", ")] : [],
    // job_is_remote is a work mode published as a field of its own, and the
    // boolean says remote in as many words. A boolean has no place in a list
    // of strings, so the word it stands for is what gets written.
    raw_mode_list: job.job_is_remote ? ["remote"] : [],
    // A blank description is the same as none, so it is left unset.
    description: job.job_description || undefined,
    ...(hasFigures ? { raw_salary } : {}),
    is_resolved: false,
    is_parsed: false,
    is_classified: false,
  };
}

// Runs one search and adds its results to the shared list. A thrown request or
// a refused one becomes a warning naming that search, so the other search
// still gets its turn and nothing is dropped in silence.
async function runSearch(
  params: Record<string, string>,
  apiKey: string,
  jobs: JobListEntry[],
  limit: number,
  warnings: string[],
  label: string
): Promise<void> {
  try {
    const res = await fetchWithTimeout(`${SEARCH_URL}?${new URLSearchParams(params).toString()}`, {
      headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": API_HOST },
    });
    if (!res.ok) {
      warnings.push(httpError(label, res.status).message);
      return;
    }
    const body = await safeJson<JSearchResponse>(res, label);
    for (const job of body.data ?? []) {
      if (jobs.length >= limit) break;
      jobs.push(toJobListEntry(job));
    }
  } catch (err) {
    warnings.push(`${label} failed: ${messageFromThrown(err)}`);
  }
}

export const jsearchCollector: Collector = {
  name: "jsearch",

  async collect({ settings, limit }): Promise<CollectorResult> {
    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      return {
        jobs: [],
        errors: ["JSearch needs RAPIDAPI_KEY in the environment."],
        warnings: [],
      };
    }

    const searchTerms = await settings.getSearchTerms();
    const location = await settings.getLocation();
    const combinedTerms = searchTerms.join(" OR ");

    const jobs: JobListEntry[] = [];
    const warnings: string[] = [];
    const sharedParams = { num_pages: "3", date_posted: "week", sort_by: "date_posted" };

    if (jobs.length < limit) {
      await runSearch(
        { ...sharedParams, query: `remote ${combinedTerms} jobs`, work_from_home: "true" },
        apiKey,
        jobs,
        limit,
        warnings,
        "JSearch remote search"
      );
    }

    if (jobs.length < limit) {
      await runSearch(
        { ...sharedParams, query: `${combinedTerms} jobs`, location },
        apiKey,
        jobs,
        limit,
        warnings,
        "JSearch local search"
      );
    }

    return { jobs, errors: [], warnings };
  },
};
