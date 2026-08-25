// Adzuna pass-through parser — declares ownership of adzuna.com but contributes
// no independent data. Adzuna is an aggregator with no per-job API endpoint,
// so the collector is the sole data source. Returns empty fields, which signals
// the pipeline to use collector data at medium confidence via compareFields.

import type { Browser } from "playwright";
import type { ParserResult } from "./types";
import type { CollectedJob } from "../collectors/types";

// Pass-through: returns empty fields so pipeline uses collector data at medium confidence
export async function parseAdzunaJob(
  url: string,
  _browser: Browser,
  _collectorData?: CollectedJob,
): Promise<ParserResult> {
  return {
    success: true,
    url,
    finalUrl: url,
    parser: "adzuna",
    fields: {},
    failedFields: [],
  };
}
