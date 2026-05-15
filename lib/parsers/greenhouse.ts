// Greenhouse parser — API-based. Fetches job data via the public Job Board API.
// Shared field mapper is used by both this parser and the Greenhouse collector.
//
// Work mode validation (2026-04-27): Greenhouse API has no structured work mode
// field. Text detection on content+location catches "remote" and "hybrid" when
// mentioned. Jobs without signals (e.g. "Seattle, WA" with no mode keywords)
// return empty work mode — correct behavior, since the pipeline defaults those
// to in-person during classification. No Playwright scrape would improve this;
// the rendered page has the same data as the API.
//
// Bonus: the API returns `company_name` directly on each job object, which
// could replace the separate /boards/{slug} call. Left as a future optimization.

import type { Browser } from "playwright";
import type { ParserResult } from "./types";
import { TRACKED_FIELDS } from "./types";
import { detectWorkModeFromText, parseSalaryFromText, fetchWithTimeout, safeJson } from "../scrapers/fetch-utils";
import { resolveCompanyName } from "./company-cache";

// Shape of the Greenhouse Job Board API response for a single job
export interface GreenhouseApiJob {
  id: number;
  title: string;
  location: { name: string };
  updated_at: string;
  content?: string;
  pay_input_ranges?: Array<{
    min_cents: number;
    max_cents: number;
    currency_type: string;
    title: string;
  }>;
}

// Shared field mapper — converts a Greenhouse API job into our normalized fields.
// Used by both the parser and the collector (Task 9).
export function mapGreenhouseFields(job: GreenhouseApiJob): {
  title: string;
  location: string;
  workMode: string;
  postedAt: string;
  salaryRange: string;
} {
  const title = job.title;
  const location = job.location?.name || "";

  // Work mode: scan content + location text (Greenhouse API has no structured field)
  const workMode = detectWorkModeFromText((job.content || "") + " " + location);

  // Date: take the first 10 chars of the ISO datetime (no timezone conversion)
  const postedAt = job.updated_at?.slice(0, 10) || "";

  // Salary: use structured pay_input_ranges first, fall back to scanning the text
  let salaryRange = "?";
  if (job.pay_input_ranges?.length) {
    const range = job.pay_input_ranges[0];
    const minK = Math.round(range.min_cents / 100000);
    const maxK = Math.round(range.max_cents / 100000);
    salaryRange = `$${minK}-${maxK}k`;
  } else if (job.content) {
    salaryRange = parseSalaryFromText(job.content);
  }

  return { title, location, workMode, postedAt, salaryRange };
}

// Extract slug and job ID from a Greenhouse URL.
// Handles: boards.greenhouse.io/{slug}/jobs/{id} and {company}.greenhouse.{tld}/jobs/{id}
export function extractGreenhouseSlugAndId(
  url: string,
): { slug: string; jobId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split("/").filter(Boolean);

  // Standard: boards.greenhouse.io/{slug}/jobs/{id}
  if (hostname === "boards.greenhouse.io") {
    const jobsIdx = pathParts.indexOf("jobs");
    if (jobsIdx > 0 && jobsIdx + 1 < pathParts.length) {
      return { slug: pathParts[jobsIdx - 1], jobId: pathParts[jobsIdx + 1] };
    }
    return null;
  }

  // Custom subdomain: {company}.greenhouse.{tld}/jobs/{id}
  const ghMatch = hostname.match(/^([^.]+)\.greenhouse\.\w+$/);
  if (ghMatch) {
    const jobsIdx = pathParts.indexOf("jobs");
    if (jobsIdx >= 0 && jobsIdx + 1 < pathParts.length) {
      return { slug: ghMatch[1], jobId: pathParts[jobsIdx + 1] };
    }
    return null;
  }

  return null;
}

// Fetch the real company name from the Greenhouse board info endpoint
async function fetchGreenhouseCompanyName(slug: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${slug}`);
    if (!res.ok) return null;
    const data = await safeJson<{ name?: string }>(res, `Greenhouse board/${slug}`);
    return data.name || null;
  } catch {
    return null;
  }
}

// Parser entry point — extracts slug/ID from URL, fetches via API, maps fields.
export async function parseGreenhouseJob(
  url: string,
  _browser: Browser,
): Promise<ParserResult> {
  try {
    const extracted = extractGreenhouseSlugAndId(url);
    if (!extracted) {
      return {
        success: false, url, finalUrl: url, parser: "greenhouse",
        fields: {}, failedFields: [...TRACKED_FIELDS],
        error: "Could not extract slug/jobId from URL",
      };
    }

    const { slug, jobId } = extracted;

    // Fetch job data from Greenhouse public API (pay_transparency=true surfaces pay_input_ranges)
    const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}?content=true&pay_transparency=true`;
    const res = await fetchWithTimeout(apiUrl);
    if (!res.ok) {
      return {
        success: false, url, finalUrl: url, parser: "greenhouse",
        fields: {}, failedFields: [...TRACKED_FIELDS],
        error: `Greenhouse API returned ${res.status}`,
      };
    }

    const job = await safeJson<GreenhouseApiJob>(res, `Greenhouse/${slug}/${jobId}`);
    const mapped = mapGreenhouseFields(job);

    // Resolve company name via DB cache, then API fallback
    const companyName = await resolveCompanyName(
      "greenhouse", slug, fetchGreenhouseCompanyName,
    );

    const fields: Record<string, string> = { ...mapped };
    if (companyName) fields.companyName = companyName;

    const failedFields = TRACKED_FIELDS.filter((f) => !fields[f]);

    return {
      success: true, url, finalUrl: url, parser: "greenhouse",
      fields, failedFields,
    };
  } catch (err) {
    return {
      success: false, url, finalUrl: url, parser: "greenhouse",
      fields: {}, failedFields: [...TRACKED_FIELDS],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
