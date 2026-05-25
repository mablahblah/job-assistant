import { prisma } from "@/lib/prisma";
import { LOCATION_CONFIG } from "@/lib/location-config";
import { prefilterLocation } from "./prefilter";
import { geocodeLocation } from "./geocode-client";
import { haversineDistanceMiles } from "./haversine";

// Info about a geocoding class the system hasn't seen before
export interface UnknownClass {
  className: string;
  locationString: string;
  displayName: string;
}

export interface GeoClassificationResult {
  // "backlog" = in range or benefit of the doubt
  // "too far" = all fragments resolved and all out of range
  // "skip"    = remote job, not our concern
  status: "backlog" | "too far" | "skip";
  unknownClasses: UnknownClass[];
}

interface FragmentResolution {
  coords: { lat: number; lon: number } | null;
}

// Resolves a single location fragment: checks cache, then geocodes.
async function resolveFragment(
  fragment: string,
  unknownClasses: UnknownClass[],
): Promise<FragmentResolution> {
  // Check cache first
  const cached = await prisma.locationCache.findUnique({
    where: { locationString: fragment },
  });
  if (cached) {
    return { coords: { lat: cached.lat, lon: cached.lon } };
  }

  // Cache miss — geocode via API (rate limiting handled by geocode-client)
  const result = await geocodeLocation(fragment);
  if (!result) return { coords: null };

  // Validate the result's class against the rules DB
  const rule = await prisma.geocodingClassRule.findUnique({
    where: { className: result.class },
  });

  if (!rule) {
    // Unknown class — flag it, treat as unresolvable
    unknownClasses.push({
      className: result.class,
      locationString: fragment,
      displayName: result.display_name,
    });
    return { coords: null };
  }

  if (rule.action === "block") {
    // Blocked class (bogus result) — treat as unresolvable
    return { coords: null };
  }

  // Allowed class — cache the result
  const lat = parseFloat(result.lat);
  const lon = parseFloat(result.lon);

  await prisma.locationCache.create({
    data: {
      locationString: fragment,
      lat,
      lon,
      displayName: result.display_name,
    },
  });

  return { coords: { lat, lon } };
}

// Classifies a job's location using the geo pipeline.
// Remote jobs return "skip" — caller should use existing remote filtering.
export async function classifyJobLocation(
  location: string,
  workMode: string,
): Promise<GeoClassificationResult> {
  // Remote jobs skip geo classification entirely
  if (workMode === "remote") {
    return { status: "skip", unknownClasses: [] };
  }

  // Preprocess the location string
  const { fragments } = prefilterLocation(location);

  // No geocodable fragments (empty, bare "Remote", etc.) — benefit of the doubt
  if (fragments.length === 0) {
    return { status: "backlog", unknownClasses: [] };
  }

  const unknownClasses: UnknownClass[] = [];
  let anyInRange = false;
  let anyUnresolvable = false;

  for (const fragment of fragments) {
    const { coords } = await resolveFragment(fragment, unknownClasses);

    if (!coords) {
      anyUnresolvable = true;
      continue;
    }

    const distance = haversineDistanceMiles(
      LOCATION_CONFIG.anchorLat,
      LOCATION_CONFIG.anchorLon,
      coords.lat,
      coords.lon,
    );

    if (distance <= LOCATION_CONFIG.radiusMiles) {
      anyInRange = true;
      break; // one in-range fragment is enough
    }
  }

  // Classification logic:
  // - Any fragment in range → backlog
  // - Any unresolvable and none in range → backlog (benefit of the doubt)
  // - All resolved and all out of range → too far
  if (anyInRange) {
    return { status: "backlog", unknownClasses };
  }

  if (anyUnresolvable) {
    return { status: "backlog", unknownClasses };
  }

  return { status: "too far", unknownClasses };
}

// Batch-classifies multiple jobs. Returns results in the same order.
// Collects all unknown classes across the batch for surfacing to the user.
export async function classifyJobLocations(
  jobs: Array<{ location: string; workMode: string }>,
): Promise<{
  results: GeoClassificationResult[];
  allUnknownClasses: UnknownClass[];
}> {
  const results: GeoClassificationResult[] = [];
  const allUnknownClasses: UnknownClass[] = [];

  for (const job of jobs) {
    const result = await classifyJobLocation(job.location, job.workMode);
    results.push(result);

    // Collect unique unknown classes across the batch
    for (const uc of result.unknownClasses) {
      if (!allUnknownClasses.some((e) => e.className === uc.className)) {
        allUnknownClasses.push(uc);
      }
    }
  }

  return { results, allUnknownClasses };
}
