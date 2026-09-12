// The Greenhouse job-posting parser. Greenhouse publishes a public JSON API
// for each posting, so this reads that API directly rather than a rendered
// page — no browser is opened, unlike the page-reading parsers.
import { fetchWithTimeout, httpError, safeJson } from "../collectors/fetch-utils";
import { withFieldsFromDescription } from "../description-fallback";
import { jobFieldsFromGreenhousePosting, type GreenhousePosting } from "../greenhouse-fields";
import { BROWSER_USER_AGENT } from "../tools/page-fetcher";
import type { Parser } from "./types";

// pay_transparency=true matters: without it the board withholds the pay field
// even where one exists, so a parser that dropped the flag would read no pay
// and nothing would say so.
const postingUrl = (slug: string, jobId: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}?content=true&pay_transparency=true`;

// Reads the board slug and posting id out of a Greenhouse link. Two shapes
// exist: a shared board (boards.greenhouse.io/{slug}/jobs/{id}, and its
// job-boards.greenhouse.io / job-boards.eu.greenhouse.io equivalents) carries
// the slug in the path, right before "jobs". An employer's own address
// ({company}.greenhouse.io/jobs/{id}) has "jobs" as the FIRST path segment,
// so there the slug comes from the hostname instead. Which shape a link is
// gets decided by where "jobs" sits in the path — not by matching the host,
// because a separate registry has already confirmed this link's domain is
// greenhouse.io before this function is ever called.
export function extractGreenhouseSlugAndId(url: string): { slug: string; jobId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const jobsIndex = segments.indexOf("jobs");
  if (jobsIndex === -1) {
    return null;
  }

  const jobId = segments[jobsIndex + 1];
  if (!jobId) {
    return null;
  }

  if (jobsIndex === 0) {
    // Employer's own address: "jobs" leads the path, so the slug is the
    // first label of the hostname instead of a path segment.
    const slug = parsed.hostname.split(".")[0];
    if (!slug) {
      return null;
    }
    return { slug, jobId };
  }

  const slug = segments[jobsIndex - 1];
  return { slug, jobId };
}

export const greenhouseParser: Parser = {
  name: "greenhouse",

  async parse({ url }) {
    const identifiers = extractGreenhouseSlugAndId(url);
    if (!identifiers) {
      // A link this parser cannot read is a parse error, not an empty read.
      throw new Error(`greenhouse: could not read a board slug and posting id from ${url}`);
    }
    const { slug, jobId } = identifiers;
    const label = `greenhouse (${slug}/${jobId})`;

    const res = await fetchWithTimeout(postingUrl(slug, jobId), {
      headers: { "user-agent": BROWSER_USER_AGENT },
    });
    if (!res.ok) {
      throw httpError(label, res.status);
    }

    const posting = await safeJson<GreenhousePosting>(res, label);

    // Verified live on 2026-09-12 against the stripe board: the single-posting
    // endpoint returns exactly the same object shape as the board-list
    // endpoint — first_published, company_name and all — so the shared
    // mapper reads it unchanged and no second request is needed to find the
    // employer's name.
    const fields = jobFieldsFromGreenhousePosting(posting, slug);

    return withFieldsFromDescription(fields, posting.content);
  },
};
