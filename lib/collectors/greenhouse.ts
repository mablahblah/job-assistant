// Fetches job listings from a company's Greenhouse job board API and returns them as CollectedJob objects.
import {
  fetchWithTimeout,
  safeJson,
  httpError,
  matchesQuery,
} from "../scrapers/fetch-utils";
import { mapGreenhouseFields, type GreenhouseApiJob } from "../parsers/greenhouse";
import type { CollectedJob } from "./types";

// Top-level shape of the Greenhouse API response.
interface GreenhouseResponse {
  jobs: GreenhouseApiJob[];
}

// Fetches all jobs from a company's Greenhouse board, filters by query keywords, and returns CollectedJob[].
export async function collectGreenhouseCompany(
  slug: string,
  queries: string[]
): Promise<CollectedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true&pay_transparency=true`;
  const res = await fetchWithTimeout(url);

  if (!res.ok) {
    if (res.status === 404) throw new Error(`${slug} — board not found`);
    throw httpError(`Greenhouse/${slug}`, res.status);
  }

  const data = await safeJson<GreenhouseResponse>(res, `Greenhouse/${slug}`);
  if (!data.jobs) return [];

  // Only keep jobs whose titles match at least one query keyword.
  const matchingJobs = data.jobs.filter((job) => matchesQuery(job.title, queries));

  return matchingJobs.map((job) => {
    const mapped = mapGreenhouseFields(job);
    return {
      url: `https://boards.greenhouse.io/${slug}/jobs/${job.id}`,
      source: "greenhouse-api",
      externalId: String(job.id),
      title: mapped.title,
      // Capitalize slug as fallback — parser will resolve the real name later
      companyName: slug.charAt(0).toUpperCase() + slug.slice(1),
      location: mapped.location,
      workMode: mapped.workMode,
      postedAt: new Date(job.updated_at),
      salaryRange: mapped.salaryRange,
      description: job.content || "",
    };
  });
}
