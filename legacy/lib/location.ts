// Classifies whether a remote job is "too far" based on location text.
// Non-remote jobs are handled by geo-based classification in lib/geocoding/.

// Remote job is eligible only if location contains one of these
const REMOTE_ELIGIBLE_KEYWORDS = [
  "united states",
  "us",
  "usa",
  "u.s.",
  "americas",
  "north america",
  "texas",
  "tx",
  "cst",
  "central time",
  "worldwide",
  "global",
  "anywhere",
  "austin",
  "round rock",
  "cedar park",
  "pflugerville",
  "bee cave",
];

export type LocationResult =
  | { tooFar: false }
  | { tooFar: true; flagged: false }
  | { tooFar: true; flagged: true };

// Classifies a remote job's location eligibility based on keyword matching.
// Only called for remote jobs — non-remote jobs use geo classification.
export function classifyLocation(workMode: string, location: string): LocationResult {
  const loc = (location ?? "").toLowerCase().trim();

  // Non-remote jobs should not reach here — but if they do, pass through
  if (workMode && workMode !== "remote") {
    return { tooFar: false };
  }

  // Remote jobs — eligible if location is empty, bare "remote", or matches approved list
  if (!loc || loc === "remote") return { tooFar: false };

  if (REMOTE_ELIGIBLE_KEYWORDS.some((kw) => loc.includes(kw))) {
    return { tooFar: false };
  }

  return { tooFar: true, flagged: false };
}
