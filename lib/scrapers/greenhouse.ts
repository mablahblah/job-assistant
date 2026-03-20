import { type ScrapedJob } from "./types";
import { fetchWithTimeout, safeJson, httpError, detectWorkModeFromText, matchesQuery, parseSalaryFromText } from "./fetch-utils";

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


export async function scrapeGreenhouseCompany(slug: string, queries: string[]): Promise<ScrapedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`${slug} — board not found`);
    throw httpError(`Greenhouse/${slug}`, res.status);
  }

  const data = await safeJson<GreenhouseResponse>(res, `Greenhouse/${slug}`);
  if (!data.jobs) return [];

  const matchingJobs = data.jobs.filter((job) => matchesQuery(job.title, queries));

  return matchingJobs.map((job) => ({
    externalId: String(job.id),
    title: job.title,
    companyName: slug.charAt(0).toUpperCase() + slug.slice(1),
    url: job.absolute_url,
    location: job.location?.name || "",
    workMode: detectWorkModeFromText((job.content || "") + " " + (job.location?.name || "")),
    postedAt: new Date(job.updated_at),
    salaryRange: parseSalaryFromText(job.content || ""),
    description: job.content || "",
  }));
}
