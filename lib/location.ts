// Classifies whether a job is "too far" based on workMode and location text.
// Remote jobs are checked against inclusion/exclusion keyword lists;
// hybrid/in-person jobs are checked against the Austin metro area.

// Cities close enough to commute to (~25 mi of North Austin)
const AUSTIN_AREA = ["austin", "round rock", "cedar park", "pflugerville"];

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
  ...AUSTIN_AREA,
];

// Checks if a location string is in the Austin metro area
function isAustinArea(location: string): boolean {
  const loc = location.toLowerCase();
  return AUSTIN_AREA.some((city) => loc.includes(city));
}

export type LocationResult =
  | { tooFar: false }                        // eligible
  | { tooFar: true; flagged: false }         // clearly too far
  | { tooFar: true; flagged: true };         // unknown remote location, needs review

// Classifies a job's location eligibility based on workMode and location text
export function classifyLocation(workMode: string, location: string): LocationResult {
  const loc = (location ?? "").toLowerCase().trim();

  // Hybrid / in-person / unknown → check Austin area
  if (workMode !== "remote") {
    if (isAustinArea(loc)) return { tooFar: false };
    return { tooFar: true, flagged: false };
  }

  // Remote jobs → eligible only if location is empty, bare "remote", or matches approved list
  if (!loc || loc === "remote") return { tooFar: false };

  if (REMOTE_ELIGIBLE_KEYWORDS.some((kw) => loc.includes(kw))) {
    return { tooFar: false };
  }

  // Doesn't match approved list → too far
  return { tooFar: true, flagged: false };
}
