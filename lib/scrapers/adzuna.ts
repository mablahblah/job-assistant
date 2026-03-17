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

export interface ScrapedJob {
  externalId: string;
  title: string;
  companyName: string;
  url: string;
  location: string;
  workMode: string;
  postedAt: Date;
  salaryRange: string;
  description: string;
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
  const fmt = (n: number) => `$${Math.round(n / 1000)}k`;
  if (min && max) return `${fmt(min)}–${fmt(max)}`;
  if (min) return `${fmt(min)}+`;
  if (max) return `up to ${fmt(max)}`;
  return "";
}

export async function scrapeAdzuna(query = "Product Designer", resultsPerPage = 50): Promise<ScrapedJob[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const apiKey = process.env.ADZUNA_API_KEY;

  if (!appId || !apiKey) {
    throw new Error("ADZUNA_APP_ID and ADZUNA_API_KEY must be set in environment variables");
  }

  const params = new URLSearchParams({
    app_id: appId,
    app_key: apiKey,
    what: query,
    results_per_page: String(resultsPerPage),
    "content-type": "application/json",
  });

  const res = await fetch(`${ADZUNA_BASE_URL}/1?${params}`);
  if (!res.ok) {
    throw new Error(`Adzuna API error: ${res.status} ${res.statusText}`);
  }

  const data: AdzunaResponse = await res.json();

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
