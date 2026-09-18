// Decides whether a job sits somewhere the user could actually work, by pairing
// every place the job names with every work mode it offers. Any one pair
// passing is enough, so a posting offering several ways of working is judged on
// its best.
//
// Containment and distance are weighed differently per mode because they answer
// different questions. Hybrid and in-person mean showing up at an office, so
// only distance counts — living inside a region the office also sits in is no
// help if the office is unreachable. Remote means working from home, so sitting
// inside the place is enough however large that place is, and a nearby anchor
// town still counts even when it does not contain the user.
import { haversineDistanceMiles } from "./haversine";
import { pointInShape, type MapShape } from "./point-in-shape";

// Only the coordinates and the outline decide the answer. The text rides along
// so the winning place can be named, and is never compared to anything.
export interface MatchablePlace {
  lookup_text: string;
  latitude: number;
  longitude: number;
  outline: MapShape | null;
}

export interface MatchLocationOptions {
  places: MatchablePlace[];
  modes: string[];
  home: { latitude: number; longitude: number };
  radiusMiles: number;
}

export interface MatchLocationResult {
  matched: boolean;
  place: string | null;
  mode: string | null;
}

// A mode word we do not recognise is read as on-site work, the stricter test,
// so a stray word cannot let a whole country through on containment alone.
function acceptsContainment(mode: string | null): boolean {
  return mode === null || mode === "remote";
}

export function matchLocation({
  places,
  modes,
  home,
  radiusMiles,
}: MatchLocationOptions): MatchLocationResult {
  // A job carrying no mode is judged on one pair whose mode is unknown, and an
  // unknown mode is recorded as nothing rather than invented as a word.
  const pairModes: (string | null)[] = modes.length > 0 ? modes : [null];

  if (places.length === 0) {
    // Nothing to measure, so only remote work can pass — a job saying only
    // "remote" is work the user could do from home. There is no place to name.
    const remote = pairModes.includes("remote") ? "remote" : null;
    return { matched: remote !== null, place: null, mode: remote };
  }

  let best: { distance: number; place: string; mode: string | null } | null = null;

  for (const place of places) {
    const distance = haversineDistanceMiles(
      home.latitude,
      home.longitude,
      place.latitude,
      place.longitude
    );
    const withinRadius = distance <= radiusMiles;
    const containsHome = pointInShape(home.longitude, home.latitude, place.outline);

    for (const mode of pairModes) {
      const passes = acceptsContainment(mode) ? containsHome || withinRadius : withinRadius;
      if (!passes) continue;

      // Strictly nearer wins, so an exact tie leaves the place listed first
      // standing. That decides only the name shown, never whether it matched.
      if (best === null || distance < best.distance) {
        best = { distance, place: place.lookup_text, mode };
      }
      break;
    }
  }

  if (best === null) return { matched: false, place: null, mode: null };
  return { matched: true, place: best.place, mode: best.mode };
}
