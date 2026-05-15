// Lever parser — pure API-based. Company name resolved via HTTP fetch of page title.
// Shared field mapper is used by both this parser and the Lever collector.

import type { Browser } from "playwright";
import type { ParserResult } from "./types";
import { TRACKED_FIELDS } from "./types";
import { detectWorkModeFromData, detectWorkModeFromText, parseSalaryFromText, fetchWithTimeout, safeJson } from "../scrapers/fetch-utils";
import { resolveCompanyName } from "./company-cache";

// Shape of a Lever posting from the API (subset of fields we use)
export interface LeverApiPosting {
  id: string;
  text: string;
  categories: { location?: string; team?: string; commitment?: string };
  createdAt: number; // epoch ms
  workplaceType?: string;
  descriptionPlain?: string;
  description?: string;
  additional?: string;
}

// Shared field mapper — converts a Lever API posting into our normalized fields.
// Used by both the parser and the collector.
export function mapLeverFields(posting: LeverApiPosting): {
  title: string;
  location: string;
  workMode: string;
  postedAt: string;
  salaryRange: string;
} {
  const title = posting.text;
  const location = posting.categories?.location || "";

  // Work mode: structured workplaceType first, then text detection fallback
  const workMode =
    detectWorkModeFromData({ workplaceType: posting.workplaceType }) ||
    detectWorkModeFromText(posting.descriptionPlain || posting.description || "");

  // Date: convert epoch ms to ISO date string (UTC)
  const postedAt = posting.createdAt
    ? new Date(posting.createdAt).toISOString().slice(0, 10)
    : "";

  // Salary: scan description text (Lever API has no structured salary field)
  const salaryRange = parseSalaryFromText(
    posting.descriptionPlain || posting.description || posting.additional || "",
  );

  return { title, location, workMode, postedAt, salaryRange };
}

// Extract slug and posting ID from a Lever URL: jobs.lever.co/{slug}/{id}
export function extractLeverSlugAndId(
  url: string,
): { slug: string; postingId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.hostname !== "jobs.lever.co") return null;

  // Split and filter removes empty strings (handles trailing slash)
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { slug: parts[0], postingId: parts[1] };
  }
  return null;
}

// Fetch company name from the Lever board page's <title> tag (no Playwright needed).
// The Lever API doesn't include company name, but the HTML title is just the company name.
async function fetchLeverCompanyName(slug: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`https://jobs.lever.co/${slug}`);
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<title>([^<]+)<\/title>/i);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// Parser entry point — extracts slug/ID from URL, fetches via API, maps fields.
// Uses Playwright only for first-time company name resolution.
export async function parseLeverJob(
  url: string,
  browser: Browser,
): Promise<ParserResult> {
  try {
    const extracted = extractLeverSlugAndId(url);
    if (!extracted) {
      return {
        success: false, url, finalUrl: url, parser: "lever",
        fields: {}, failedFields: [...TRACKED_FIELDS],
        error: "Could not extract slug/postingId from URL",
      };
    }

    const { slug, postingId } = extracted;

    // Fetch posting data from Lever public API
    const apiUrl = `https://api.lever.co/v0/postings/${slug}/${postingId}`;
    const res = await fetchWithTimeout(apiUrl);
    if (!res.ok) {
      return {
        success: false, url, finalUrl: url, parser: "lever",
        fields: {}, failedFields: [...TRACKED_FIELDS],
        error: `Lever API returned ${res.status}`,
      };
    }

    const posting = await safeJson<LeverApiPosting>(res, `Lever/${slug}/${postingId}`);
    const mapped = mapLeverFields(posting);

    // Resolve company name via DB cache → HTTP fetch fallback
    const companyName = await resolveCompanyName(
      "lever", slug, fetchLeverCompanyName,
    );

    const fields: Record<string, string> = { ...mapped };
    if (companyName) fields.companyName = companyName;

    const failedFields = TRACKED_FIELDS.filter((f) => !fields[f]);

    return {
      success: true, url, finalUrl: url, parser: "lever",
      fields, failedFields,
    };
  } catch (err) {
    return {
      success: false, url, finalUrl: url, parser: "lever",
      fields: {}, failedFields: [...TRACKED_FIELDS],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
