import { type ScrapedJob } from "./types";
import { fetchWithTimeout, safeJson, httpError, formatSalary, detectWorkModeFromData } from "./fetch-utils";

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
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_period?: string;
  job_description?: string;
}

interface JSearchResponse {
  status: string;
  data: JSearchJob[];
}

export interface JSearchOptions {
  query: string;
  location?: string;       // e.g. "Austin, United States"
  workFromHome?: boolean;   // true = remote jobs only
}

function formatLocation(job: JSearchJob): string {
  const parts = [job.job_city, job.job_state, job.job_country].filter(Boolean);
  return parts.join(", ");
}

// Fetch one page of JSearch results sorted by date
export async function scrapeJSearch({ query, location, workFromHome }: JSearchOptions): Promise<ScrapedJob[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    throw new Error("Missing API key: RAPIDAPI_KEY");
  }

  const params = new URLSearchParams({
    query,
    num_pages: "1",
    date_posted: "week",
    sort_by: "date_posted",
  });

  if (location) params.set("location", location);
  if (workFromHome) params.set("work_from_home", "true");

  const res = await fetchWithTimeout(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "jsearch.p.rapidapi.com",
    },
  });

  if (!res.ok) throw httpError("JSearch", res.status);

  const data = await safeJson<JSearchResponse>(res, "JSearch");
  if (!data.data) return [];

  return data.data.map((job) => ({
    externalId: job.job_id,
    title: job.job_title,
    companyName: job.employer_name,
    url: job.job_apply_link,
    location: formatLocation(job),
    workMode: detectWorkModeFromData({ isRemote: job.job_is_remote }),
    postedAt: job.job_posted_at_datetime_utc ? new Date(job.job_posted_at_datetime_utc) : new Date(),
    salaryRange: formatSalary(job.job_min_salary, job.job_max_salary, job.job_salary_period ?? undefined),
    description: job.job_description || "",
  }));
}
