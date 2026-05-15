// Types for the parser pipeline — defines the data shape at each stage

import type { Browser } from "playwright";
import type { CollectedJob } from "../collectors/types";

// Fields every parser extracts from a job page
export interface ParsedFields {
  title: string;
  companyName: string;
  location: string;
  workMode: string;
  postedAt: string; // ISO date string
  salaryRange: string;
}

// All tracked field names — used for iteration in confidence comparison
export const TRACKED_FIELDS = [
  "title",
  "companyName",
  "location",
  "workMode",
  "postedAt",
  "salaryRange",
] as const;
export type TrackedFieldName = (typeof TRACKED_FIELDS)[number];

// Result from running a page parser on a single job
export interface ParserResult {
  success: boolean;
  url: string;
  finalUrl: string;
  parser: string;
  fields: Partial<ParsedFields>;
  failedFields: TrackedFieldName[]; // names of fields the parser couldn't extract
  error?: string; // set when the whole parse failed
}

// Per-field confidence after comparing parser vs collector data
export type FieldConfidence = "high" | "medium" | "low";

export interface ConfidenceResult {
  field: TrackedFieldName;
  confidence: FieldConfidence;
  value: string;
  parserValue?: string;
  collectorValue?: string;
}

// Subset of JSON-LD JobPosting schema — fields we extract
export interface JobPostingLD {
  "@type"?: string;
  title?: string;
  datePosted?: string;
  validThrough?: string;
  jobBenefits?: string;
  jobLocationType?: string;
  baseSalary?: {
    value?: { minValue?: number; maxValue?: number };
  };
  jobLocation?: {
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
    };
  };
  hiringOrganization?: { name?: string };
  description?: string;
}

// A job as it flows through the pipeline (DB data + resolution result)
export interface PipelineJob {
  id: string;
  url: string;
  title: string;
  companyName: string;
  finalUrl: string;
  finalDomain: string;
  source: "greenlit-shortcut" | "resolved";
}

// Parser receives a URL, a browser instance, and optional collector data.
// Each parser decides whether to use the browser (Playwright), make API calls,
// or pass through collector data (aggregator parsers with no independent source).
export type ParserFn = (url: string, browser: Browser, collectorData?: CollectedJob) => Promise<ParserResult>;
