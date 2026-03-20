import { type ScrapedJob } from "./types";
import { fetchWithTimeout, safeJson, httpError, detectWorkModeFromData, detectWorkModeFromText, matchesQuery } from "./fetch-utils";

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

export async function scrapeLeverCompany(slug: string, queries: string[]): Promise<ScrapedJob[]> {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`${slug} — board not found`);
    throw httpError(`Lever/${slug}`, res.status);
  }

  const postings = await safeJson<LeverPosting[]>(res, `Lever/${slug}`);
  if (!Array.isArray(postings)) return [];

  const matchingPostings = postings.filter((posting) =>
    matchesQuery(posting.text, queries) || matchesQuery(posting.categories?.team || "", queries)
  );

  return matchingPostings.map((posting) => ({
    externalId: posting.id,
    title: posting.text,
    companyName: slug.charAt(0).toUpperCase() + slug.slice(1),
    url: posting.hostedUrl,
    location: posting.categories?.location || "",
    // try structured enum first, fall back to text detection on description
    workMode: detectWorkModeFromData({ workplaceType: posting.workplaceType }) || detectWorkModeFromText(posting.descriptionPlain || posting.description || ""),
    postedAt: new Date(posting.createdAt),
    salaryRange: "?",
    description: posting.descriptionPlain || posting.description || "",
  }));
}
