// Page parser for Ashby (jobs.ashbyhq.com) — extracts structured job data
// Primary source: __appData (Ashby's React data blob) for most fields.
// Fallback: JSON-LD for company name (not in __appData), HTML for title.

import type { Browser } from "playwright";
import type { ParserResult, ParsedFields } from "./types";
import { TRACKED_FIELDS } from "./types";
import { extractJsonLd, stripHtml } from "./parse-utils";
import { parseSalaryFromText } from "../scrapers/fetch-utils";

// Fields we extract from Ashby's window.__appData
export interface AshbyAppData {
  title?: string;
  workplaceType?: string; // "Remote", "Hybrid", "On-Site"
  locationName?: string; // primary location display name
  secondaryLocationNames?: string[]; // additional locations
  publishedDate?: string; // ISO date string, e.g. "2026-04-06"
  compensationTierSummary?: string; // e.g. "$126.5K – $169K • Offers Equity"
}

// Pure extraction — appData is the primary source, JSON-LD/HTML are fallbacks.
export function parseAshbyHtml(
  html: string,
  appData?: AshbyAppData | null,
): Partial<ParsedFields> {
  const fields: Partial<ParsedFields> = {};
  const ld = extractJsonLd(html);

  // Title: __appData > JSON-LD > first h1
  if (appData?.title) {
    fields.title = appData.title;
  } else if (ld.title) {
    fields.title = ld.title;
  } else {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) fields.title = stripHtml(h1Match[1]);
  }

  // Company: JSON-LD only (__appData doesn't include company name)
  if (ld.hiringOrganization?.name) {
    fields.companyName = ld.hiringOrganization.name;
  }

  // Work mode: __appData.workplaceType is authoritative
  // (JSON-LD uses TELECOMMUTE for both hybrid and remote — unreliable)
  // When not set but a location exists, default to in-person — a physical
  // location with no mode means assume office-based.
  if (appData?.workplaceType) {
    const wt = appData.workplaceType.toLowerCase();
    if (wt === "hybrid") fields.workMode = "hybrid";
    else if (wt === "remote") fields.workMode = "remote";
    else if (wt === "on-site" || wt === "onsite") fields.workMode = "in-person";
    else fields.workMode = wt;
  } else if (appData?.locationName) {
    fields.workMode = "in-person";
  }

  // Location: __appData primary + secondary names combined
  // classifyLocation checks this string for Austin-area cities
  if (appData?.locationName) {
    const allLocations = [
      appData.locationName,
      ...(appData.secondaryLocationNames ?? []),
    ];
    fields.location = allLocations.join(", ");
  } else if (ld.jobLocation?.address) {
    // Fallback to JSON-LD if no appData
    const addr = ld.jobLocation.address;
    const parts: string[] = [];
    if (addr.addressLocality) parts.push(addr.addressLocality);
    if (addr.addressRegion && addr.addressRegion !== addr.addressCountry) {
      parts.push(addr.addressRegion);
    }
    if (addr.addressCountry) parts.push(addr.addressCountry);
    if (parts.length > 0) fields.location = parts.join(", ");
  }

  // Posted date: __appData > JSON-LD (raw string, no timezone conversion)
  if (appData?.publishedDate) {
    fields.postedAt = appData.publishedDate;
  } else if (ld.datePosted) {
    fields.postedAt = ld.datePosted;
  }

  // Salary: JSON-LD baseSalary > __appData summary > text scan
  if (ld.baseSalary?.value) {
    const { minValue, maxValue } = ld.baseSalary.value;
    if (minValue && maxValue) {
      const toK = (n: number) => Math.round(n / 1000);
      fields.salaryRange = `$${toK(minValue)}-${toK(maxValue)}k`;
    }
  } else if (appData?.compensationTierSummary) {
    // Expand "$126.5K" → "$126500" so parseSalaryFromText's regex can match
    const expanded = appData.compensationTierSummary.replace(
      /\$([\d.]+)K/gi,
      (_, n) => `$${Math.round(parseFloat(n) * 1000)}`,
    );
    const salary = parseSalaryFromText(expanded);
    if (salary !== "?") fields.salaryRange = salary;
  } else {
    const salary = parseSalaryFromText(html);
    if (salary !== "?") fields.salaryRange = salary;
  }

  return fields;
}

// Playwright wrapper — opens its own page from the shared browser,
// extracts __appData for mode/location, then HTML for the rest.
export async function parseAshbyJob(
  url: string,
  browser: Browser,
): Promise<ParserResult> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    // Wait briefly for React to hydrate and populate __appData
    await page.waitForTimeout(1500);

    // Extract Ashby's React data blob for work mode + locations
    const appData: AshbyAppData | null = await page.evaluate(() => {
      const raw = (window as any).__appData;
      const d = raw?.jobPosting ?? raw?.posting ?? raw;
      if (!d) return null;
      return {
        title: d.title,
        workplaceType: d.workplaceType,
        locationName: d.locationName,
        secondaryLocationNames: d.secondaryLocationNames,
        publishedDate: d.publishedDate,
        compensationTierSummary: d.compensationTierSummary,
      };
    });

    const html = await page.content();
    const fields = parseAshbyHtml(html, appData);

    const failedFields = TRACKED_FIELDS.filter((f) => !fields[f]);

    return {
      success: true,
      url,
      finalUrl: page.url(),
      parser: "ashby",
      fields,
      failedFields,
    };
  } catch (err) {
    return {
      success: false,
      url,
      finalUrl: url,
      parser: "ashby",
      fields: {},
      failedFields: [...TRACKED_FIELDS],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  } finally {
    // Always close the context to free browser resources
    await context.close();
  }
}
