// Geocoding spike: tests location prefilter + Nominatim geocoding + haversine distance.
// Takes a zip code and radius (miles) from CLI args, geocodes a curated test set,
// and reports which locations are in range.
// Run: npx tsx scripts/geocoding-spike.ts 78750 30

import { prefilterLocation } from "./spike-helpers/prefilter";
import { haversineDistanceMiles } from "./spike-helpers/haversine";

// --- Types ---

type Expected = "near" | "far" | "skip";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  importance: number;
  type: string;
  class: string;
}

interface GeocodedFragment {
  fragment: string;
  lat: number;
  lng: number;
  displayName: string;
  distance: number;
}

// --- Curated test set ---

const TEST_LOCATIONS: Array<[string, Expected]> = [
  // City, County — common pipeline format
  ["Austin, Travis County", "near"],
  ["Bee Cave, Travis County", "near"],
  ["Seattle, King County", "far"],

  // City, State
  ["Austin, Texas", "near"],
  ["Dallas, TX", "far"],
  ["San Francisco, California", "far"],

  // City, State, Country verbose
  ["Chattanooga, TN, US, Tennessee, United States", "far"],
  ["Los Angeles, CA, US, California, United States", "far"],

  // City, Country
  ["London, United Kingdom, GB", "far"],
  ["Amsterdam, Netherlands, NL", "far"],
  ["Berlin, Germany, DE", "far"],

  // City only
  ["Athens", "skip"],
  ["Colorado Springs", "far"],
  ["Montreal", "far"],

  // County only
  ["Salt Lake County, Utah", "far"],

  // State/region only
  ["California, US", "far"],
  ["Colorado, US", "far"],
  ["Maryland, US", "far"],

  // Country only
  ["Canada", "far"],
  ["Ireland", "far"],
  ["US", "skip"],

  // Multi-location (comma-separated)
  ["NYC, Los Angeles", "skip"],
  ["Paris, Warsaw, Istanbul", "skip"],
  ["London & NYC", "skip"],

  // Multi-location (semicolon)
  ["New York, NY; San Francisco, CA", "skip"],
  ["Berlin, Germany; Dublin, Ireland; London, England", "skip"],

  // Freeform with office name
  ["Binti HQ - San Francisco, CA", "skip"],
  ["Right Formula London", "skip"],
  ["San Francisco-HQ", "skip"],
  ["Hub - San Francisco", "skip"],

  // Neighborhood/district
  ["Hayes Valley, San Francisco", "far"],
  ["SoMa, San Francisco", "far"],
  ["Highland Park, Dallas", "far"],
  ["Covent Garden", "far"],

  // Near-Austin Travis County locations
  ["Tarrytown, Travis County", "near"],
  ["Dessau, Travis County", "near"],
  ["Bluff Springs, Travis County", "near"],
  ["Sprinkle, Travis County", "near"],
  ["Travis Heights, Travis County", "near"],
  ["Balcones, Travis County", "near"],
  ["Mc Neil, Travis County", "near"],

  // Multi-country
  ["UK / US", "skip"],
  ["US / Canada", "skip"],

  // Bare "Remote" on non-remote job
  ["Remote", "skip"],

  // Empty/whitespace
  ["", "skip"],
  [" ", "skip"],

  // Location with qualifier
  ["San Francisco / Bay Area", "far"],
  ["Great Seattle area, San Francisco", "skip"],

  // Dash-separated multi-location
  ["San Francisco, CA - New York, NY - United States", "skip"],
];

// --- Helpers ---

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocode(query: string): Promise<NominatimResult | null> {
  if (!query.trim()) return null;

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "job-assistant-spike" },
  });
  const data: NominatimResult[] = await res.json();
  return data.length > 0 ? data[0] : null;
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: npx tsx scripts/geocoding-spike.ts <zip> <radius_miles>");
    process.exit(1);
  }

  const [zip, radiusStr] = args;
  const radius = parseFloat(radiusStr);

  // Step 1: Geocode the anchor zip code
  console.log(`\nGeocoding anchor zip: ${zip}...`);
  const anchor = await geocode(zip);
  if (!anchor) {
    console.error(`Failed to geocode zip: ${zip}`);
    process.exit(1);
  }

  const anchorLat = parseFloat(anchor.lat);
  const anchorLng = parseFloat(anchor.lon);
  console.log(
    `Anchor: ${anchor.display_name} (${anchorLat}, ${anchorLng})\n`
  );
  console.log(`Radius: ${radius} miles\n`);

  // Step 2: Process each test location
  const COL = {
    input: 55,
    prefilter: 40,
    resolved: 50,
    dist: 12,
    inRange: 10,
    expected: 10,
    result: 8,
  };

  console.log(
    "Input".padEnd(COL.input),
    "Prefilter Output".padEnd(COL.prefilter),
    "Resolved To".padEnd(COL.resolved),
    "Dist(mi)".padStart(COL.dist),
    "InRange".padStart(COL.inRange),
    "Expected".padStart(COL.expected),
    "Result".padStart(COL.result)
  );
  console.log("─".repeat(COL.input + COL.prefilter + COL.resolved + COL.dist + COL.inRange + COL.expected + COL.result + 6));

  let pass = 0;
  let fail = 0;
  let review = 0;

  for (const [input, expected] of TEST_LOCATIONS) {
    const pf = prefilterLocation(input);

    // If prefilter skipped → no geocoding needed
    if (pf.fragments.length === 0) {
      const resultStr = expected === "skip" ? "PASS" : "REVIEW";
      if (resultStr === "PASS") pass++;
      else review++;

      console.log(
        (input || "(empty)").padEnd(COL.input),
        "(skipped)".padEnd(COL.prefilter),
        "—".padEnd(COL.resolved),
        "—".padStart(COL.dist),
        "—".padStart(COL.inRange),
        expected.padStart(COL.expected),
        resultStr.padStart(COL.result)
      );
      continue;
    }

    // Geocode each fragment, find the closest one
    let bestFragment: GeocodedFragment | null = null;

    for (const fragment of pf.fragments) {
      await delay(1100); // respect Nominatim rate limit

      const geo = await geocode(fragment);
      if (!geo) continue;

      const lat = parseFloat(geo.lat);
      const lng = parseFloat(geo.lon);
      const dist = haversineDistanceMiles(anchorLat, anchorLng, lat, lng);

      if (!bestFragment || dist < bestFragment.distance) {
        bestFragment = {
          fragment,
          lat,
          lng,
          displayName: geo.display_name,
          distance: dist,
        };
      }
    }

    if (!bestFragment) {
      // Geocoding returned no results for any fragment
      const resultStr = expected === "skip" ? "PASS" : "REVIEW";
      if (resultStr === "PASS") pass++;
      else review++;

      console.log(
        (input || "(empty)").padEnd(COL.input),
        pf.fragments.join(" | ").slice(0, COL.prefilter - 1).padEnd(COL.prefilter),
        "(no result)".padEnd(COL.resolved),
        "—".padStart(COL.dist),
        "—".padStart(COL.inRange),
        expected.padStart(COL.expected),
        resultStr.padStart(COL.result)
      );
      continue;
    }

    const inRange = bestFragment.distance <= radius;
    let resultStr: string;

    if (expected === "skip") {
      // We expected skip but got a geocoded result — worth reviewing
      resultStr = "REVIEW";
      review++;
    } else if (expected === "near" && inRange) {
      resultStr = "PASS";
      pass++;
    } else if (expected === "far" && !inRange) {
      resultStr = "PASS";
      pass++;
    } else {
      resultStr = "FAIL";
      fail++;
    }

    console.log(
      (input || "(empty)").padEnd(COL.input),
      pf.fragments.join(" | ").slice(0, COL.prefilter - 1).padEnd(COL.prefilter),
      bestFragment.displayName.slice(0, COL.resolved - 1).padEnd(COL.resolved),
      bestFragment.distance.toFixed(1).padStart(COL.dist),
      (inRange ? "YES" : "no").padStart(COL.inRange),
      expected.padStart(COL.expected),
      resultStr.padStart(COL.result)
    );
  }

  // Summary
  console.log("\n" + "─".repeat(40));
  console.log(`Results: ${pass} PASS, ${fail} FAIL, ${review} REVIEW`);
  console.log(`Total: ${TEST_LOCATIONS.length} test cases`);
}

main().catch(console.error);
