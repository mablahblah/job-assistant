import {
  fetchWithTimeout,
  safeJson,
  httpError,
  formatSalary,
  detectWorkModeFromData,
} from "../scrapers/fetch-utils";
import type { CollectedJob } from "./types";

// Shape of a single job returned by the JSearch (RapidAPI) response.
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

// Top-level shape of the JSearch API response.
interface JSearchResponse {
  status: string;
  data: JSearchJob[] | null;
}

// Options accepted by the JSearch collector.
export interface JSearchOptions {
  query: string;
  location?: string;
  workFromHome?: boolean;
}

// Combines city, state, and country into a single location string.
function formatLocation(job: JSearchJob): string {
  const parts = [job.job_city, job.job_state, job.job_country].filter(Boolean);
  return parts.join(", ");
}

// Fetches jobs from the JSearch API (via RapidAPI) and returns them as lightweight CollectedJob objects.
export async function collectJSearch({
  query,
  location,
  workFromHome,
}: JSearchOptions): Promise<CollectedJob[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error("Missing RAPIDAPI_KEY env var");

  const params = new URLSearchParams({
    query,
    num_pages: "3",
    date_posted: "week",
    sort_by: "date_posted",
  });
  if (location) params.set("location", location);
  if (workFromHome) params.set("work_from_home", "true");

  const res = await fetchWithTimeout(
    `https://jsearch.p.rapidapi.com/search?${params}`,
    {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "jsearch.p.rapidapi.com",
      },
    }
  );
  if (!res.ok) throw httpError("JSearch", res.status);

  const data = await safeJson<JSearchResponse>(res, "JSearch");
  if (!data.data) return [];

  // Map each raw API job to the minimal CollectedJob shape.
  return data.data.map((job) => ({
    url: job.job_apply_link,
    source: "jsearch",
    externalId: job.job_id,
    title: job.job_title,
    companyName: job.employer_name,
    location: formatLocation(job),
    workMode: detectWorkModeFromData({ isRemote: job.job_is_remote }),
    dates: job.job_posted_at_datetime_utc
      ? [new Date(job.job_posted_at_datetime_utc)]
      : [],
    salaryRange: formatSalary(
      job.job_min_salary,
      job.job_max_salary,
      job.job_salary_period ?? undefined
    ),
    description: job.job_description || "",
  }));
}
