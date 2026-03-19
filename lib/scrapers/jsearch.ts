import { type ScrapedJob } from "./types";
import { fetchWithTimeout, safeJson, httpError } from "./fetch-utils";

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

function formatLocation(job: JSearchJob): string {
  const parts = [job.job_city, job.job_state, job.job_country].filter(Boolean);
  return parts.join(", ");
}

function formatSalary(min?: number, max?: number, period?: string): string {
  if (!min && !max) return "";
  const k = (n: number) => Math.round(n / 1000);
  const isAnnual = !period || period === "YEAR";
  const fmt = (n: number) => (isAnnual ? `$${k(n)}k` : `$${n}/${period?.toLowerCase()}`);

  if (min && max) return isAnnual ? `$${k(min)}-${k(max)}k` : `${fmt(min)}-${fmt(max)}`;
  if (min) return `${fmt(min)}+`;
  if (max) return `up to ${fmt(max)}`;
  return "";
}

export async function scrapeJSearch(query = "Product Designer", numPages = 1): Promise<ScrapedJob[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    throw new Error("Missing API key: RAPIDAPI_KEY");
  }

  const params = new URLSearchParams({
    query,
    num_pages: String(numPages),
    date_posted: "week",
  });

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
    workMode: job.job_is_remote ? "remote" : "",
    postedAt: job.job_posted_at_datetime_utc ? new Date(job.job_posted_at_datetime_utc) : new Date(),
    salaryRange: formatSalary(job.job_min_salary, job.job_max_salary, job.job_salary_period),
    description: job.job_description || "",
  }));
}
