import {
  fetchWithTimeout,
  safeJson,
  httpError,
  formatSalary,
  detectWorkModeFromText,
} from "../scrapers/fetch-utils";
import type { CollectedJob } from "./types";

const ADZUNA_BASE_URL = "https://api.adzuna.com/v1/api/jobs/us/search";

// Shape of a single job returned by the Adzuna API.
interface AdzunaJob {
  id: string;
  title: string;
  company: { display_name: string };
  description: string;
  redirect_url: string;
  location: { display_name: string };
  salary_min?: number;
  salary_max?: number;
  created: string;
}

// Top-level shape of the Adzuna search response.
interface AdzunaResponse {
  results: AdzunaJob[] | null;
  count: number;
}

// Options for a single Adzuna API call.
export interface AdzunaOptions {
  titleOnly: string;       // matched against job title only
  what?: string;           // matched against title + description (used for "remote")
  whatExclude?: string;    // exclude ads containing these terms (space-separated)
  where?: string;          // location filter (zip code or city)
  distance?: string;       // radius in km from the where location
}

// Fetches jobs from the Adzuna API with targeted filters.
export async function collectAdzuna(options: AdzunaOptions): Promise<CollectedJob[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const apiKey = process.env.ADZUNA_API_KEY;
  if (!appId || !apiKey) {
    throw new Error("Missing ADZUNA_APP_ID / ADZUNA_API_KEY env vars");
  }

  const params = new URLSearchParams({
    app_id: appId,
    app_key: apiKey,
    title_only: options.titleOnly,
    max_days_old: "8",
    salary_min: "100000",
    salary_include_unknown: "1",
    sort_by: "date",
    results_per_page: "50",
    "content-type": "application/json",
  });
  if (options.what) params.set("what", options.what);
  if (options.whatExclude) params.set("what_exclude", options.whatExclude);
  if (options.where) params.set("where", options.where);
  if (options.distance) params.set("distance", options.distance);

  const res = await fetchWithTimeout(`${ADZUNA_BASE_URL}/1?${params}`);
  if (!res.ok) throw httpError("Adzuna", res.status);

  const data = await safeJson<AdzunaResponse>(res, "Adzuna");
  if (!data.results) return [];

  // Map each raw API job to the minimal CollectedJob shape.
  return data.results.map((job) => ({
    url: job.redirect_url,
    source: "adzuna",
    externalId: job.id,
    title: job.title,
    companyName: job.company.display_name,
    location: job.location.display_name,
    workMode: detectWorkModeFromText(job.description + " " + job.title),
    dates: [new Date(job.created)],
    salaryRange: formatSalary(job.salary_min, job.salary_max),
    description: job.description,
  }));
}
