// Dribbble parser — static HTML fetch. Extracts job data from server-rendered
// HTML: inline script data (Dribbble.JobListing.initialize) > JSON-LD > description text.

import type { Browser } from "playwright";
import type { ParsedFields, ParserResult } from "./types";
import { TRACKED_FIELDS } from "./types";
import { extractJsonLd, stripHtml } from "./parse-utils";
import { fetchWithTimeout, parseSalaryFromText } from "../scrapers/fetch-utils";

// Shape of the tracking properties in Dribbble.JobListing.initialize()
interface DribbbleTrackingProps {
  job_title?: string;
  job_company?: string;
  job_id?: string;
  job_location?: string;
  job_location_country?: string;
  job_location_state?: string;
  job_role_type?: string;
}

// Shape of the full initialize() argument
interface DribbbleAppData {
  locationType?: string;
  trackingProperties?: DribbbleTrackingProps;
}

// Extract the Dribbble.JobListing.initialize({...}) argument from HTML.
// Uses targeted field regexes instead of JSON.parse — real pages have HTML entities
// and URLs in string values that break naive JS-to-JSON conversion.
function extractDribbbleAppData(html: string): DribbbleAppData | null {
  // Allow whitespace between ( and { — real pages split across lines
  const initMatch = html.match(
    /Dribbble\.JobListing\.initialize\(\s*\{([\s\S]*?)\}\s*\)/,
  );
  if (!initMatch) return null;

  const block = initMatch[1];

  // Extract a string value by key from a JS object block
  const strVal = (src: string, key: string) => {
    const m = src.match(new RegExp(key + ':\\s*"([^"]*)"'));
    return m?.[1];
  };

  // Extract trackingProperties sub-object
  const tpMatch = block.match(/trackingProperties:\s*\{([\s\S]*?)\}/);
  let trackingProperties: DribbbleTrackingProps | undefined;
  if (tpMatch) {
    const tp = tpMatch[1];
    trackingProperties = {
      job_title: strVal(tp, "job_title"),
      job_company: strVal(tp, "job_company"),
      job_id: strVal(tp, "job_id"),
      job_location: strVal(tp, "job_location"),
      job_location_country: strVal(tp, "job_location_country"),
      job_location_state: strVal(tp, "job_location_state"),
      job_role_type: strVal(tp, "job_role_type"),
    };
  }

  return {
    locationType: strVal(block, "locationType"),
    trackingProperties,
  };
}

// Pure extraction — all fields from static HTML
export function parseDribbbleHtml(html: string): Partial<ParsedFields> {
  const fields: Partial<ParsedFields> = {};
  const appData = extractDribbbleAppData(html);
  const ld = extractJsonLd(html);
  const tp = appData?.trackingProperties;

  // Title: app data > JSON-LD
  if (tp?.job_title) {
    fields.title = tp.job_title;
  } else if (ld.title) {
    fields.title = ld.title;
  }

  // Company: app data > JSON-LD
  if (tp?.job_company) {
    fields.companyName = tp.job_company;
  } else if (ld.hiringOrganization?.name) {
    fields.companyName = ld.hiringOrganization.name;
  }

  // Work mode: map Dribbble's locationType to our values.
  // JSON-LD jobLocationType "TELECOMMUTE" is unreliable (used for both hybrid and remote).
  if (appData?.locationType) {
    const lt = appData.locationType;
    if (lt === "remote" || lt === "remote_only") fields.workMode = "remote";
    else if (lt === "onsite_or_remote") fields.workMode = "hybrid";
    else if (lt === "onsite_only") fields.workMode = "in-person";
    else fields.workMode = "";
  } else if (appData) {
    // App data exists but no locationType — unknown
    fields.workMode = "";
  }

  // Location: combine all fragments from app data + JSON-LD, deduplicate.
  // Gives classifyLocation max surface area to match Austin-area keywords.
  const locationParts: string[] = [];

  // job_location can be a composite like "Austin, TX" — split so sub-fragments dedup individually
  if (tp?.job_location) {
    for (const frag of tp.job_location.split(",").map((s) => s.trim()).filter(Boolean)) {
      locationParts.push(frag);
    }
  }
  if (tp?.job_location_country) locationParts.push(tp.job_location_country);
  if (tp?.job_location_state) locationParts.push(tp.job_location_state);

  if (ld.jobLocation?.address) {
    const addr = ld.jobLocation.address;
    if (addr.addressLocality) locationParts.push(addr.addressLocality);
    if (addr.addressRegion) locationParts.push(addr.addressRegion);
    if (addr.addressCountry) locationParts.push(addr.addressCountry);
  }

  // Deduplicate exact-match fragments
  const seen = new Set<string>();
  const dedupedParts: string[] = [];
  for (const part of locationParts) {
    if (!seen.has(part)) {
      seen.add(part);
      dedupedParts.push(part);
    }
  }

  if (dedupedParts.length > 0) {
    fields.location = dedupedParts.join(", ");
  }

  // Posted date: JSON-LD datePosted, first 10 chars (date portion only, no TZ conversion)
  if (ld.datePosted) {
    fields.postedAt = ld.datePosted.slice(0, 10);
  }

  // Salary: scan JSON-LD description text (no structured salary field on Dribbble)
  if (ld.description) {
    const salary = parseSalaryFromText(stripHtml(ld.description));
    if (salary !== "?") fields.salaryRange = salary;
  }

  return fields;
}

// Entry point — fetches HTML via HTTP (no Playwright needed), delegates to pure parser.
export async function parseDribbbleJob(
  url: string,
  _browser: Browser,
  _collectorData?: import("../collectors/types").CollectedJob,
): Promise<ParserResult> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      return {
        success: false, url, finalUrl: url, parser: "dribbble",
        fields: {}, failedFields: [...TRACKED_FIELDS],
        error: `Dribbble returned ${res.status}`,
      };
    }

    const html = await res.text();
    const fields = parseDribbbleHtml(html);
    const failedFields = TRACKED_FIELDS.filter((f) => !fields[f]);

    return {
      success: true, url, finalUrl: url, parser: "dribbble",
      fields, failedFields,
    };
  } catch (err) {
    return {
      success: false, url, finalUrl: url, parser: "dribbble",
      fields: {}, failedFields: [...TRACKED_FIELDS],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
