// Fetches job listings from a company's Lever job board API and returns them as CollectedJob objects.
import {
  fetchWithTimeout,
  safeJson,
  httpError,
  matchesQuery,
} from "../scrapers/fetch-utils";
import { mapLeverFields, type LeverApiPosting } from "../parsers/lever";
import type { CollectedJob } from "./types";

// Fetches all postings from a company's Lever board, filters by query keywords, and returns CollectedJob[].
export async function collectLeverCompany(
  slug: string,
  queries: string[]
): Promise<CollectedJob[]> {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const res = await fetchWithTimeout(url);

  if (!res.ok) {
    if (res.status === 404) throw new Error(`${slug} — board not found`);
    throw httpError(`Lever/${slug}`, res.status);
  }

  const postings = await safeJson<LeverApiPosting[]>(res, `Lever/${slug}`);
  if (!Array.isArray(postings)) return [];

  // Keep postings whose title OR team name matches at least one query keyword.
  const matchingPostings = postings.filter(
    (posting) =>
      matchesQuery(posting.text, queries) ||
      matchesQuery(posting.categories?.team || "", queries)
  );

  return matchingPostings.map((posting) => {
    const mapped = mapLeverFields(posting);
    return {
      url: `https://jobs.lever.co/${slug}/${posting.id}`,
      source: "lever-api",
      externalId: posting.id,
      title: mapped.title,
      // Capitalize slug as fallback — parser will resolve the real name later
      companyName: slug.charAt(0).toUpperCase() + slug.slice(1),
      location: mapped.location,
      workMode: mapped.workMode,
      postedAt: new Date(posting.createdAt),
      salaryRange: mapped.salaryRange,
      description: posting.descriptionPlain || posting.description || "",
    };
  });
}
