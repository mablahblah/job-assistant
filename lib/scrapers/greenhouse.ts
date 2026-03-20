import { type ScrapedJob } from "./types";
import { fetchWithTimeout, safeJson, httpError } from "./fetch-utils";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location: { name: string };
  updated_at: string;
  content: string;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

// Extract salary range from free-form HTML content (e.g. "$73,000 - $150,000")
function parseSalary(html: string): string {
  const pattern = /\$[\d,]+(?:\.\d+)?\s*[-–—to]+\s*\$?[\d,]+(?:\.\d+)?/i;
  const match = html.match(pattern);
  return match ? match[0] : "?";
}

function detectWorkMode(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("in-person") || lower.includes("on-site") || lower.includes("onsite") || lower.includes("in office")) {
    return "in-person";
  }
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("remote")) return "remote";
  return "";
}

export async function scrapeGreenhouseCompany(slug: string, queries: string[]): Promise<ScrapedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`${slug} — board not found`);
    throw httpError(`Greenhouse/${slug}`, res.status);
  }

  const data = await safeJson<GreenhouseResponse>(res, `Greenhouse/${slug}`);
  if (!data.jobs) return [];

  const lowerQueries = queries.map((q) => q.toLowerCase());
  const matchingJobs = data.jobs.filter((job) => {
    const title = job.title.toLowerCase();
    return lowerQueries.some((q) => title.includes(q));
  });

  return matchingJobs.map((job) => ({
    externalId: String(job.id),
    title: job.title,
    companyName: slug.charAt(0).toUpperCase() + slug.slice(1),
    url: job.absolute_url,
    location: job.location?.name || "",
    workMode: detectWorkMode((job.content || "") + " " + (job.location?.name || "")),
    postedAt: new Date(job.updated_at),
    salaryRange: parseSalary(job.content || ""),
    description: job.content || "",
  }));
}
