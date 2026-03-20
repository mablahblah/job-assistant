import { type ScrapedJob } from "./types";
import { fetchWithTimeout, safeJson, httpError, formatSalary, detectWorkModeFromText } from "./fetch-utils";
export type { ScrapedJob } from "./types";

const ADZUNA_BASE_URL = "https://api.adzuna.com/v1/api/jobs/us/search";

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

interface AdzunaResponse {
  results: AdzunaJob[];
  count: number;
}

export async function scrapeAdzuna(query = "Product Designer", resultsPerPage = 50): Promise<ScrapedJob[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const apiKey = process.env.ADZUNA_API_KEY;

  if (!appId || !apiKey) {
    throw new Error("Missing API key: ADZUNA_APP_ID / ADZUNA_API_KEY");
  }

  const params = new URLSearchParams({
    app_id: appId,
    app_key: apiKey,
    what: query,
    results_per_page: String(resultsPerPage),
    "content-type": "application/json",
  });

  const res = await fetchWithTimeout(`${ADZUNA_BASE_URL}/1?${params}`);
  if (!res.ok) throw httpError("Adzuna", res.status);

  const data = await safeJson<AdzunaResponse>(res, "Adzuna");
  if (!data.results) return [];

  return data.results.map((job) => ({
    externalId: job.id,
    title: job.title,
    companyName: job.company.display_name,
    url: job.redirect_url,
    location: job.location.display_name,
    workMode: detectWorkModeFromText(job.description + " " + job.title),
    postedAt: new Date(job.created),
    salaryRange: formatSalary(job.salary_min, job.salary_max),
    description: job.description,
  }));
}
