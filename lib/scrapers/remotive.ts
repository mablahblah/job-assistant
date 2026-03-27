import { type ScrapedJob } from "./types";
import { fetchWithTimeout, safeJson, httpError, parseSalaryFromText } from "./fetch-utils";

// Shape of a single job from the Remotive API
interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location: string;
  salary: string;
  publication_date: string;
  description: string;
}

interface RemotiveResponse {
  "job-count": number;
  jobs: RemotiveJob[];
}

// Fetch remote jobs from Remotive, searching across all user terms in one call
export async function scrapeRemotive(queries: string[]): Promise<ScrapedJob[]> {
  // Join all user search terms into a single query string
  const search = queries.join(", ");

  const params = new URLSearchParams({
    search,
    category: "design",
  });

  const res = await fetchWithTimeout(`https://remotive.com/api/remote-jobs?${params}`);
  if (!res.ok) throw httpError("Remotive", res.status);

  const data = await safeJson<RemotiveResponse>(res, "Remotive");
  if (!data.jobs) return [];

  return data.jobs.map((job) => ({
    externalId: String(job.id),
    title: job.title,
    companyName: job.company_name,
    url: job.url,
    location: job.candidate_required_location || "Remote",
    workMode: "remote", // Remotive is a remote-only job board
    postedAt: new Date(job.publication_date),
    salaryRange: job.salary ? parseSalaryFromText(job.salary) : "?",
    description: job.description || "",
  }));
}
