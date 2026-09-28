// Reads a web page's search-engine job data: a schema.org JobPosting block
// published as JSON-LD inside a <script type="application/ld+json"> tag.
// Search engines use this data to show job listings in results, so most job
// pages carry it — this file finds that block and pulls out the handful of
// details the pipeline maps onto a job record.
import { parseHTML } from "linkedom";

import type { MappedJobFields } from "../types/job-list-entry";
import { placeFromParts } from "./place-from-parts";

// The fields this file reads off a JobPosting block. Pages publish whatever
// they like beyond the schema, so every field is optional and loosely typed
// — runtime checks narrow each one before it is used.
export type JobPosting = {
  "@type"?: unknown;
  datePosted?: unknown;
  dateModified?: unknown;
  jobLocationType?: unknown;
  jobLocation?: unknown;
  applicantLocationRequirements?: unknown;
  description?: unknown;
  title?: unknown;
  hiringOrganization?: unknown;
  baseSalary?: unknown;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A block counts as a JobPosting when its @type is that string, or an array
// that contains it.
function isJobPosting(value: unknown): value is JobPosting {
  if (!isRecord(value)) return false;
  const type = value["@type"];
  return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
}

// A JSON-LD tag's content may be one object, a list of objects, or an
// object wrapping its list in "@graph". This looks inside all three shapes
// for the first JobPosting.
function jobPostingFromParsedBlock(block: unknown): JobPosting | null {
  if (isJobPosting(block)) return block;
  if (Array.isArray(block)) {
    for (const item of block) {
      if (isJobPosting(item)) return item;
    }
    return null;
  }
  if (isRecord(block) && Array.isArray(block["@graph"])) {
    for (const item of block["@graph"]) {
      if (isJobPosting(item)) return item;
    }
  }
  return null;
}

// Looks at every JSON-LD tag on the page, in order, and returns the first
// one that holds a JobPosting. A tag that fails to parse is skipped rather
// than thrown over, since a page can carry other, unrelated JSON-LD too.
export function jobPostingFromHtml(html: string): JobPosting | null {
  const { document } = parseHTML(html);
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const posting = jobPostingFromParsedBlock(parsed);
    if (posting !== null) return posting;
  }
  return null;
}

// A string that reads as a real date, converted to one. Anything else —
// missing, not a string, or not a valid date — comes back undefined so the
// caller can leave the field out entirely rather than save a bad date.
function dateFromValue(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isTelecommute(value: unknown): boolean {
  return value === "TELECOMMUTE" || (Array.isArray(value) && value.includes("TELECOMMUTE"));
}

// A field that may be given as one item or a list of them, always read as a
// list.
function listFromValue(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// A country may be given as a plain name, or as an object with a "name".
function nameFromCountry(country: unknown): string | undefined {
  if (typeof country === "string") return country;
  if (isRecord(country) && typeof country["name"] === "string") return country["name"];
  return undefined;
}

// One jobLocation's address becomes one place: a plain string is kept as it
// is, an address object is joined from its city, state and country parts.
function placeFromJobLocation(location: unknown): string | undefined {
  if (!isRecord(location)) return undefined;
  const address = location["address"];
  if (typeof address === "string") return address.trim() ? address : undefined;
  if (!isRecord(address)) return undefined;
  const locality = typeof address["addressLocality"] === "string" ? address["addressLocality"] : undefined;
  const region = typeof address["addressRegion"] === "string" ? address["addressRegion"] : undefined;
  const country = nameFromCountry(address["addressCountry"]);
  return placeFromParts([locality, region, country]);
}

// One applicantLocationRequirements item (usually a Country) becomes one
// place, read from its name.
function placeFromLocationRequirement(requirement: unknown): string | undefined {
  if (!isRecord(requirement)) return undefined;
  const name = requirement["name"];
  return typeof name === "string" && name.trim() ? name : undefined;
}

// Reads exactly the five details this app maps from a JobPosting — never
// title, employer or pay, which come from elsewhere.
export function jobFieldsFromJobPosting(posting: JobPosting): MappedJobFields {
  const fields: MappedJobFields = {};

  const postedDate = dateFromValue(posting.datePosted);
  if (postedDate !== undefined) fields.posting_date = postedDate;

  const updatedDate = dateFromValue(posting.dateModified);
  if (updatedDate !== undefined) fields.posting_updated_date = updatedDate;

  if (isTelecommute(posting.jobLocationType)) fields.raw_mode_list = ["remote"];

  const places = [
    ...listFromValue(posting.jobLocation).map(placeFromJobLocation),
    ...listFromValue(posting.applicantLocationRequirements).map(placeFromLocationRequirement),
  ].filter((place): place is string => place !== undefined);
  if (places.length > 0) fields.raw_location_list = places;

  if (typeof posting.description === "string" && posting.description.length > 0) {
    fields.description = posting.description;
  }

  return fields;
}
