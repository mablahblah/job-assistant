// Cuts a job posting's location string into single places, and lifts out any
// work mode named inside it.
//
// A later step judges each place against a map, one at a time, so a glued
// string is worth less than its parts. Measured across 2,208 real jobs,
// cutting at every delimiter and gluing nothing back on gained 32 matches and
// lost none: "Travis County" alone contains the user's home point, while
// "Bee Cave, Travis County" did not.
//
// Every piece is kept, including one naming nothing on a map. Of 796 such
// fragments, only ten landed within thirty miles of the user, and every one of
// those was a genuine local place — so nothing is filtered for looking like a
// company name.
import type { WorkMode } from "./work-mode";

export interface LocationSplit {
  places: string[];
  modes: WorkMode[];
}

// One pattern per mode, so a mode named twice is still held once, and the
// modes come back in this order rather than the order the string happens to
// name them.
const MODE_WORDS: Array<[RegExp, WorkMode]> = [
  [/\b(fully\s+)?remote(?:\s+(?:ok|solely))?\b/i, "remote"],
  [/\bhybrid\b/i, "hybrid"],
  [/\b(on[- ]?site|in[- ]?office|in[- ]?person)\b/i, "in-person"],
];

const ANY_MODE =
  /\b((fully\s+)?remote(?:\s+(?:ok|solely))?|hybrid|on[- ]?site|in[- ]?office|in[- ]?person)\b/gi;

// The one hand-kept list this feature carries. FILLER surrounds a place
// without being part of its name; NOISE is a whole fragment that only names a
// kind of workplace or area. NOISE is matched against the whole fragment so
// that "Austin HQ" survives while a bare "HQ" does not.
const FILLER =
  /^(open to|based in|located in|anywhere in|in|within|from|the|all|select|only|or|and)\s+/i;
const NOISE =
  /^(locations?|select locations?|all locations?|no location restrictions?|only|and|or|hub|office|hq|select|area|areas|region|regions)$/i;

function tidy(fragment: string): string {
  let result = fragment.replace(/\s{2,}/g, " ").trim();
  result = result.replace(/^[\s,\-–—+()|]+|[\s,\-–—+()|]+$/g, "").trim();
  // Filler stacks — "open to anywhere in Austin" — so strip until nothing changes.
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result.replace(FILLER, "").trim();
  }
  return result.replace(/^[\s,\-–—+|]+|[\s,\-–—+|]+$/g, "").trim();
}

export function splitLocation(raw: string): LocationSplit {
  const location = raw.trim();

  const modes: WorkMode[] = [];
  for (const [pattern, mode] of MODE_WORDS) {
    if (pattern.test(location)) modes.push(mode);
  }
  if (!location) return { places: [], modes };

  // Every delimiter cuts. Nothing is glued back on.
  const parts = location.split(/\s*[;•,/|():]\s*|\s+[-–—]\s+|\s+or\s+/i);

  const places: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const place = tidy(part.replace(ANY_MODE, " "));
    if (!place || NOISE.test(place)) continue;
    const key = place.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(place);
  }

  return { places, modes };
}
