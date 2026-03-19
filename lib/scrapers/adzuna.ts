import { type ScrapedJob } from "./types";
import { fetchWithTimeout, safeJson, httpError } from "./fetch-utils";
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

function detectWorkMode(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("in-person") || lower.includes("on-site") || lower.includes("onsite") || lower.includes("in office")) {
    return "in-person";
  }
  if (lower.includes("hybrid")) {
    return "hybrid";
  }
  return "remote";
}

function formatSalary(min?: number, max?: number): string {
  const k = (n: number) => Math.round(n / 1000);
  if (min && max) return `$${k(min)}-${k(max)}k`;
  if (min) return `$${k(min)}k+`;
  if (max) return `up to $${k(max)}k`;
  return "";
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
    workMode: detectWorkMode(job.description + " " + job.title),
    postedAt: new Date(job.created),
    salaryRange: formatSalary(job.salary_min, job.salary_max),
    description: job.description,
  }));
}
