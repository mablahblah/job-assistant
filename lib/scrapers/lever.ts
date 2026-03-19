import { type ScrapedJob } from "./types";
import { fetchWithTimeout, safeJson, httpError } from "./fetch-utils";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  categories: {
    location?: string;
    team?: string;
    commitment?: string;
  };
  createdAt: number;
  descriptionPlain?: string;
  description?: string;
  additional?: string;
  workplaceType?: string;
}

function mapWorkplaceType(type?: string, text?: string): string {
  if (type === "remote") return "remote";
  if (type === "hybrid") return "hybrid";
  if (type === "on-site") return "in-person";
  if (text) {
    const lower = text.toLowerCase();
    if (lower.includes("remote")) return "remote";
    if (lower.includes("hybrid")) return "hybrid";
    if (lower.includes("on-site") || lower.includes("onsite") || lower.includes("in-person")) return "in-person";
  }
  return "";
}

export async function scrapeLeverCompany(slug: string, queries: string[]): Promise<ScrapedJob[]> {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`${slug} — board not found`);
    throw httpError(`Lever/${slug}`, res.status);
  }

  const postings = await safeJson<LeverPosting[]>(res, `Lever/${slug}`);
  if (!Array.isArray(postings)) return [];

  const lowerQueries = queries.map((q) => q.toLowerCase());
  const matchingPostings = postings.filter((posting) => {
    const title = posting.text.toLowerCase();
    const team = (posting.categories?.team || "").toLowerCase();
    return lowerQueries.some((q) => title.includes(q) || team.includes(q));
  });

  return matchingPostings.map((posting) => ({
    externalId: posting.id,
    title: posting.text,
    companyName: slug.charAt(0).toUpperCase() + slug.slice(1),
    url: posting.hostedUrl,
    location: posting.categories?.location || "",
    workMode: mapWorkplaceType(posting.workplaceType, posting.descriptionPlain || posting.description || ""),
    postedAt: new Date(posting.createdAt),
    salaryRange: "",
    description: posting.descriptionPlain || posting.description || "",
  }));
}
