// Turns a place's text into its coordinates and its outline, using the
// geocode.maps.co front end to Nominatim.
//
// The service allows one lookup a second, so the tool holds its own timer
// rather than trusting every caller to wait.
//
// A refusal stores nothing and is never retried. A run resolving hundreds of
// places cannot afford to back off and wait, and a place that comes back empty
// is simply tried again on the next run.
import type { MapShape } from "../utils/point-in-shape";

const SEARCH_URL = "https://geocode.maps.co/search";

// One second between lookups, plus a buffer for clock drift on the way out.
export const GEOCODE_PACING_MS = 1100;

export interface GeocodedPlace {
  latitude: number;
  longitude: number;
  place_type: string;
  display_name: string;
  outline: MapShape | null;
}

export interface Geocoder {
  lookUp(text: string): Promise<GeocodedPlace | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The service answers with coordinates as strings. An absent or unreadable one
// must not fall through as NaN or zero, which would read later as a real place
// off the coast of Africa.
function readCoordinate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// A name or a type the service left out is stored empty rather than throwing
// the place away. Only the coordinates and the outline decide a match, so a
// place missing its label is still worth keeping.
function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readOutline(value: unknown): MapShape | null {
  if (!isRecord(value)) return null;
  const type = value["type"];
  if (typeof type !== "string" || !("coordinates" in value)) return null;
  return { type, coordinates: value["coordinates"] };
}

function readPlace(value: unknown): GeocodedPlace | null {
  if (!isRecord(value)) return null;

  const latitude = readCoordinate(value["lat"]);
  const longitude = readCoordinate(value["lon"]);
  if (latitude === null || longitude === null) return null;

  return {
    latitude,
    longitude,
    place_type: readText(value["addresstype"]),
    display_name: readText(value["display_name"]),
    outline: readOutline(value["geojson"]),
  };
}

function requestUrl(text: string, apiKey: string): string {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", text);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  // Only the best match is used, so asking for more is paid for and thrown away.
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("polygon_geojson", "1");
  // An unsimplified country outline runs to megabytes, so ask for it rounded off.
  url.searchParams.set("polygon_threshold", "0.01");
  return url.toString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGeocoder(): Geocoder {
  // Held per geocoder rather than in module state, so a test can pace a run
  // without a reset hook.
  let nextRequestAt = 0;

  return {
    async lookUp(text: string): Promise<GeocodedPlace | null> {
      const query = text.trim();
      if (query === "") return null;

      // Read at call time, not at construction, and thrown rather than returned
      // empty: a missing key used to make every job fail to classify silently.
      const apiKey = process.env["GEOCODE_MAPS_API_KEY"];
      if (apiKey === undefined || apiKey === "") {
        throw new Error("GEOCODE_MAPS_API_KEY is not set, so no place can be looked up.");
      }

      const holdFor = nextRequestAt - Date.now();
      if (holdFor > 0) await wait(holdFor);
      nextRequestAt = Date.now() + GEOCODE_PACING_MS;

      try {
        const response = await fetch(requestUrl(query, apiKey));
        if (!response.ok) return null;

        const body: unknown = await response.json();
        if (!Array.isArray(body)) return null;

        const first: unknown = body[0];
        return first === undefined ? null : readPlace(first);
      } catch {
        return null;
      }
    },
  };
}
