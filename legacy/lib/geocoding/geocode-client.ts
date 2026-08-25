import "dotenv/config";

// Shape of a single result from the Nominatim / geocode.maps.co API
export interface GeocodeResult {
  lat: string;
  lon: string;
  display_name: string;
  class: string;
  type: string;
  importance: number;
}

const API_BASE = "https://geocode.maps.co/search";
const MIN_INTERVAL_MS = 1100; // 1 req/sec free tier + buffer
const MAX_RETRIES = 2;

// Module-level state for global rate limiting across all callers
let lastCallTime = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ensures minimum spacing between API calls (global, not per-job)
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (lastCallTime > 0 && elapsed < MIN_INTERVAL_MS) {
    await delay(MIN_INTERVAL_MS - elapsed);
  }
  lastCallTime = Date.now();
}

// Calls geocode.maps.co to convert a location string to coordinates.
// Retries on 429 (rate limit) up to MAX_RETRIES times with backoff.
// Returns the top result or null if nothing resolved.
export async function geocodeLocation(
  query: string,
): Promise<GeocodeResult | null> {
  if (!query.trim()) return null;

  const envKey = process.env.GEOCODE_MAPS_API_KEY;
  if (!envKey) {
    console.error("[geocoding] GEOCODE_MAPS_API_KEY not set in .env");
    return null;
  }

  const params = new URLSearchParams({
    q: query,
    api_key: envKey,
    format: "json",
    limit: "1",
  });
  const url = `${API_BASE}?${params}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForRateLimit();

    try {
      const res = await fetch(url);

      if (res.status === 429) {
        if (attempt < MAX_RETRIES) {
          const retryAfter = res.headers.get("Retry-After");
          const waitMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : MIN_INTERVAL_MS * (attempt + 1);
          console.warn(
            `[geocoding] 429 for "${query}", retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`,
          );
          await delay(waitMs);
          continue;
        }
        console.error(
          `[geocoding] 429 for "${query}" after ${MAX_RETRIES} retries`,
        );
        return null;
      }

      if (!res.ok) {
        console.error(
          `[geocoding] API returned ${res.status} for "${query}"`,
        );
        return null;
      }

      const data = (await res.json()) as GeocodeResult[];
      return data.length > 0 ? data[0] : null;
    } catch (err) {
      console.error(`[geocoding] Fetch error for "${query}":`, err);
      return null;
    }
  }

  return null;
}

// Reset module state between tests
export function _resetForTesting(): void {
  lastCallTime = 0;
}
