// The Dribbble job-posting parser. Dribbble serves finished server-rendered
// HTML for each job page, so unlike the parsers that read a source's API,
// this one reads the page itself. A plain fetch and a parse do
// everything a browser would here, so no browser is opened.
import { withFieldsFromDescription } from "../utils/description-fallback";
import { jobPostingFromHtml, jobFieldsFromJobPosting } from "../utils/job-posting-data";
import type { MappedJobFields } from "../types/job-list-entry";
import { fetchPageHtml } from "../tools/page-fetcher";
import type { Parser } from "./parser";

// The fields read out of Dribbble.JobListing.initialize({...})'s
// trackingProperties sub-object.
interface DribbbleTrackingProperties {
  job_title?: string;
  job_company?: string;
  job_location?: string;
  job_location_country?: string;
  job_location_state?: string;
}

// Pulls one quoted string value for `key` out of a block of JS object
// literal text. The inline block cannot be JSON.parse'd — real pages carry
// HTML entities and raw URLs inside string values that break any naive
// JS-to-JSON conversion — so each key is read individually with its own
// targeted regex instead.
function extractStringValue(block: string, key: string): string | undefined {
  const match = new RegExp(`${key}:\\s*"([^"]*)"`).exec(block);
  return match?.[1];
}

// Reads trackingProperties as its own sub-block first, so a key of the same
// name elsewhere in the initialize() block cannot be picked up by mistake.
function parseTrackingProperties(initializeBlock: string): DribbbleTrackingProperties {
  const match = /trackingProperties:\s*\{([\s\S]*?)\}/.exec(initializeBlock);
  if (match === null) return {};
  const block = match[1];
  return {
    job_title: extractStringValue(block, "job_title"),
    job_company: extractStringValue(block, "job_company"),
    job_location: extractStringValue(block, "job_location"),
    job_location_country: extractStringValue(block, "job_location_country"),
    job_location_state: extractStringValue(block, "job_location_state"),
  };
}

// Dribbble's own work-mode words are not ones the app's normalizer
// recognises, so they are translated here. The JSON-LD's own jobLocationType
// is deliberately not read: it says TELECOMMUTE for both hybrid and remote
// postings, so it contradicts locationType and would erase the distinction
// this translation exists to preserve.
function mapLocationType(locationType: string | undefined): string[] {
  switch (locationType) {
    case "remote":
    case "remote_only":
      return ["remote"];
    case "onsite_or_remote":
      return ["hybrid"];
    case "onsite_only":
      return ["in-person"];
    default:
      return [];
  }
}

// The JobPosting type (from the shared reader) marks every field `unknown`,
// since it has no idea what shape a given site's block takes. These two
// helpers check a value's shape before anything is read off it — the
// runtime version of what the deleted DribbbleJsonLd interface used to
// promise at compile time.
function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

// Builds the ordered, deduplicated list of place fragments from every source
// that names one. job_location can be a composite like "Austin, TX", so it is
// split into its own fragments up front — so each sub-fragment dedupes
// individually against whatever comes after it, rather than the composite
// string blocking a later exact match.
function buildLocationList(
  tracking: DribbbleTrackingProperties,
  address: Record<string, unknown> | undefined
): string[] {
  const candidates: Array<string | null | undefined> = [
    ...(tracking.job_location?.split(",") ?? []),
    tracking.job_location_country,
    tracking.job_location_state,
    readString(address?.addressLocality),
    readString(address?.addressRegion),
    readString(address?.addressCountry),
  ];

  const result: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && !result.includes(trimmed)) {
      result.push(trimmed);
    }
  }
  return result;
}

export function parseDribbbleHtml(html: string): MappedJobFields {
  const initializeMatch = /Dribbble\.JobListing\.initialize\(\s*\{([\s\S]*?)\}\s*\)/.exec(html);
  const initializeBlock = initializeMatch?.[1] ?? "";
  const tracking = parseTrackingProperties(initializeBlock);
  const locationType = extractStringValue(initializeBlock, "locationType");

  // The JSON-LD block itself, read through the shared reader instead of a
  // Dribbble-only copy. It comes back typed loosely, so every field below is
  // checked before use.
  const posting = jobPostingFromHtml(html);
  const jobLocation = readObject(posting?.jobLocation);
  const address = readObject(jobLocation?.address);

  const fields: MappedJobFields = {};

  const rawTitle = tracking.job_title ?? readString(posting?.title);
  if (rawTitle !== undefined) fields.raw_title = rawTitle;

  const rawCompanyName =
    tracking.job_company ?? readString(readObject(posting?.hiringOrganization)?.name);
  if (rawCompanyName !== undefined) fields.raw_company_name = rawCompanyName;

  // Work mode and the location list stay Dribbble's own translation — the
  // shared reader's versions of these are deliberately not used here.
  fields.raw_mode_list = mapLocationType(locationType);
  fields.raw_location_list = buildLocationList(tracking, address);

  // The shared reader turns a readable datePosted into a Date and otherwise
  // leaves the key absent, so its result is used as-is.
  const mapped = posting ? jobFieldsFromJobPosting(posting) : {};
  if (mapped.posting_date !== undefined) fields.posting_date = mapped.posting_date;

  // The description is written as-is, not merely scanned for a salary and
  // then discarded — that is what the legacy Dribbble parser did, which left
  // Dribbble the one source reaching scoring blind. Its collector stores no
  // description either, so this parser is the only place it can come from.
  if (mapped.description !== undefined) fields.description = mapped.description;

  return fields;
}

export const dribbbleParser: Parser = {
  name: "dribbble",

  async parse({ url }) {
    const html = await fetchPageHtml(url);
    const fields = parseDribbbleHtml(html);
    // Dribbble publishes no pay field of its own, so any salary here comes
    // only from scanning the description this parser just wrote.
    return withFieldsFromDescription(fields, fields.description ?? undefined);
  },
};
