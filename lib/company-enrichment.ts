import { ApifyClient } from "apify-client";
import { prisma } from "@/lib/prisma";

// Remote strings that don't help narrow down the company's physical location
const REMOTE_LOCATION_PATTERNS = [/^remote$/i, /^remote,?\s*us$/i, /^united states$/i, /^us$/i];

function isRemoteLocation(location?: string): boolean {
  if (!location) return true;
  return REMOTE_LOCATION_PATTERNS.some((p) => p.test(location.trim()));
}

// Checks if the search result's title/snippet roughly matches the company we searched for.
// Neither needs to be exact — we just check one contains the other (case-insensitive).
function namesMatch(companyName: string, candidate: string): boolean {
  const a = companyName.toLowerCase();
  const b = candidate.toLowerCase();
  return a.includes(b) || b.includes(a);
}

// Apify actor result shape — organic search result row
interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

// Scan all organic snippets for a US phone number — returns first match found
function extractPhone(items: SearchResult[]): string | undefined {
  for (const item of items) {
    // Matches (XXX) XXX-XXXX, XXX-XXX-XXXX, XXX.XXX.XXXX, etc.
    const m = item.snippet.match(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
    if (m) return m[0];
  }
}

// Scan all organic snippets for a website URL — prefers "Website: www.xxx.com" patterns
function extractWebsite(items: SearchResult[]): string | undefined {
  for (const item of items) {
    // Look for explicit "Website." or "Website:" label followed by a domain
    const m = item.snippet.match(/(?:website|web)[.:]\s*((?:https?:\/\/)?[\w.-]+\.[a-z]{2,})/i);
    if (m) {
      const raw = m[1];
      return raw.startsWith("http") ? raw : `https://${raw}`;
    }
  }
}

// Scan all organic snippets for a US-style street address
function extractAddress(items: SearchResult[]): string | undefined {
  for (const item of items) {
    const s = item.snippet;
    // Look for "Headquarters." or "Address:" label followed by the address text
    const labeled = s.match(/(?:headquarters|address)[.:\s]+(\d+\s+[^;,\n]{10,60}[A-Z]{2}[\s,]+\d{5})/i);
    if (labeled) return labeled[1].trim();
    // Fallback: bare street address with state + zip anywhere in the snippet
    const bare = s.match(/\d+\s+\w+.*?(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Pl|Ct|Fl|Floor)\b.*\b[A-Z]{2}\s+\d{5}/);
    if (bare) return bare[0].trim();
  }
}

// Enriches a company with address/phone/website using the Apify Google Search scraper.
// Fire-and-forget: errors are logged but never thrown — callers use .catch(console.error).
// Idempotent: skips companies that already have enrichedAt set.
export async function enrichCompany(companyId: string, jobLocation?: string): Promise<void> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return;
  if (company.enrichedAt) return; // already enriched — skip

  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.warn("[enrichment] APIFY_API_TOKEN not set — skipping enrichment");
    await prisma.company.update({
      where: { id: companyId },
      data: { enrichmentStatus: "failed" },
    });
    return;
  }

  // Include job location in query only if it's a real place (not "Remote" or blank)
  const locationSuffix = !isRemoteLocation(jobLocation) ? ` ${jobLocation}` : "";
  const searchQuery = `${company.name}${locationSuffix} headquarters address, phone number, domain url`;

  let items: SearchResult[];
  try {
    const client = new ApifyClient({ token });
    const run = await client.actor("datarava/google-search-results-scraper").call({
      search_term: [searchQuery],
      country: "United States",
      language: "English",
      number_of_target_records: 10, // actor minimum is 10
    });
    const dataset = await client.dataset(run.defaultDatasetId).listItems();
    items = dataset.items as unknown as SearchResult[];
  } catch (err) {
    console.error(`[enrichment] Apify call failed for "${company.name}":`, err);
    await prisma.company.update({
      where: { id: companyId },
      data: { enrichmentStatus: "failed" },
    });
    return;
  }

  if (!items.length) {
    await prisma.company.update({
      where: { id: companyId },
      data: { enrichedAt: new Date(), enrichmentStatus: "failed", enrichmentUncertain: true, enrichmentFlags: "missing_data" },
    });
    return;
  }

  const address = extractAddress(items);
  const phone = extractPhone(items);
  const website = extractWebsite(items);

  // --- Uncertainty heuristics ---
  const flags: string[] = [];

  // Flag if the address doesn't look like it's in the US
  const usPattern = /\b[A-Z]{2}\s+\d{5}|\bUnited States\b/i;
  if (address && !usPattern.test(address)) {
    flags.push("address_outside_us");
  }

  // Flag if the top result's title doesn't resemble the company we searched for
  const topTitle = items[0]?.title ?? "";
  if (topTitle && !namesMatch(company.name, topTitle)) {
    flags.push("name_mismatch");
  }

  // Flag if we're missing key contact fields
  if (!address || !phone) {
    flags.push("missing_data");
  }

  await prisma.company.update({
    where: { id: companyId },
    data: {
      address: address ?? null,
      phone: phone ?? null,
      website: website ?? null,
      enrichedAt: new Date(),
      enrichmentStatus: "complete",
      enrichmentUncertain: flags.length > 0,
      enrichmentFlags: flags.length > 0 ? flags.join(",") : null,
    },
  });

  console.log(
    `[enrichment] enriched "${company.name}"${flags.length > 0 ? ` (flags: ${flags.join(",")})` : ""}`
  );
}
