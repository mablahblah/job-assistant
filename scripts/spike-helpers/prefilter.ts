// Prefilter: cleans messy location strings into geocodable fragments.
// Strips office/HQ suffixes, company prefixes, work-mode qualifiers,
// then splits multi-location strings. Returns an empty array for
// un-geocodable inputs (bare "Remote", empty, etc.)

export interface PrefilterResult {
  fragments: string[];
  action: "passthrough" | "cleaned" | "split" | "skipped";
}

// Work-mode qualifiers to strip (case-insensitive)
const WORK_MODE_PATTERNS = [
  /\bfully\s+remote\b/gi,
  /\bremote\b/gi,
  /\bhybrid\b/gi,
  /\bon[- ]?site\b/gi,
  /\bin[- ]?office\b/gi,
  /\bin[- ]?person\b/gi,
];

// Office/HQ suffix patterns to strip
const SUFFIX_PATTERNS = [
  /\s*\(HQ\)/gi,
  /\s*-\s*HQ$/gi,
  /-HQ$/gi,
  /\s+HQ$/gi,
  /\s+Office$/gi,
  /\s+Headquarters$/gi,
];

// Company prefix patterns: "CompanyName HQ - City" or "Hub - City"
// These are identified by a dash separator with a known prefix keyword
const PREFIX_PATTERNS = [
  /^.+?\bHQ\s*-\s*/i, // "Binti HQ - San Francisco" → "San Francisco"
  /^Hub\s*-\s*/i, // "Hub - San Francisco" → "San Francisco"
];

// Known company-prefixed location patterns: "CompanyName City"
// These are hard to detect generically; we handle known ones
const COMPANY_PREFIX_PATTERNS = [
  /^Right Formula\s+/i, // "Right Formula London" → "London"
];

// Splitting delimiters for multi-location strings
const SPLIT_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\s*;\s*/, name: "semicolon" },
  { pattern: /\s*•\s*/, name: "bullet" },
  { pattern: /\s*&\s*/, name: "ampersand" },
  { pattern: /\s*\/\s*/, name: "slash" },
];

// Strings that are ONLY remote qualifiers with optional region
const PURE_REMOTE_PATTERNS = [
  /^\s*remote\s*$/i,
  /^\s*remote\s*[-–—]\s*.+$/i, // "Remote - US", "Remote- United States"
  /^\s*remote\s+\w+.*$/i, // "Remote US"
  /^\s*remote\s*\(.*\)\s*$/i, // "Remote (US only)"
  /^\s*.+,\s*remote\s*$/i, // "LATAM, Remote"
];

/**
 * Check if a string is purely a remote/work-mode qualifier with no geocodable content
 */
function isPureRemote(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return true;
  return PURE_REMOTE_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Strip work-mode qualifiers from a string, then clean up punctuation artifacts
 */
function stripWorkMode(s: string): string {
  let result = s;
  for (const p of WORK_MODE_PATTERNS) {
    result = result.replace(p, "");
  }
  // Clean up leftover punctuation/whitespace from stripping
  result = result
    .replace(/\s*[-–—]\s*,/g, ",") // "Toronto - , ..." → "Toronto, ..."
    .replace(/,\s*[-–—]\s*/g, ",") // ", - ..." → ", ..."
    .replace(/\s*[-–—]\s*$/g, "") // trailing dash
    .replace(/^\s*[-–—]\s*/g, "") // leading dash
    .replace(/\(\s*\)/g, "") // empty parens
    .replace(/,\s*,/g, ",") // double commas
    .replace(/,\s*$/g, "") // trailing comma
    .replace(/^\s*,\s*/g, "") // leading comma
    .trim();
  return result;
}

/**
 * Strip office/HQ suffixes from a string
 */
function stripSuffixes(s: string): string {
  let result = s;
  for (const p of SUFFIX_PATTERNS) {
    result = result.replace(p, "");
  }
  return result.trim();
}

/**
 * Strip company-name prefixes from a string
 */
function stripPrefixes(s: string): string {
  let result = s;
  for (const p of PREFIX_PATTERNS) {
    result = result.replace(p, "");
  }
  for (const p of COMPANY_PREFIX_PATTERNS) {
    result = result.replace(p, "");
  }
  return result.trim();
}

/**
 * Try to split a string on multi-location delimiters.
 * Returns null if no split delimiter found.
 */
function trySplit(s: string): string[] | null {
  for (const { pattern } of SPLIT_PATTERNS) {
    const parts = s.split(pattern).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) return parts;
  }
  return null;
}

/**
 * Main prefilter: takes a raw location string and returns cleaned fragments
 * suitable for geocoding, plus the action taken.
 */
export function prefilterLocation(raw: string): PrefilterResult {
  // Empty / whitespace → skip
  if (!raw || !raw.trim()) {
    return { fragments: [], action: "skipped" };
  }

  const trimmed = raw.trim();

  // Pure remote strings → skip entirely
  if (isPureRemote(trimmed)) {
    return { fragments: [], action: "skipped" };
  }

  // Step 1: Strip prefixes and suffixes (office names, HQ, etc.)
  const cleaned = stripPrefixes(stripSuffixes(trimmed));

  // If stripping removed everything → skip
  if (!cleaned) {
    return { fragments: [], action: "skipped" };
  }

  // Step 2: Try splitting on multi-location delimiters BEFORE stripping
  // work-mode qualifiers (so "Berlin / fully remote" splits on "/")
  const parts = trySplit(cleaned);
  if (parts) {
    // Strip work-mode qualifiers from each fragment, then filter
    const geocodable = parts
      .map((p) => stripWorkMode(stripSuffixes(p)).trim())
      .filter((p) => p && !isPureRemote(p));

    if (geocodable.length === 0) {
      return { fragments: [], action: "skipped" };
    }

    return { fragments: geocodable, action: "split" };
  }

  // Step 3: No split delimiter found — strip work-mode qualifiers from
  // the whole string, then try splitting again (handles "Remote, SF, NYC"
  // where commas separate locations but also appear in "City, State")
  const strippedWorkMode = stripWorkMode(cleaned);

  if (!strippedWorkMode) {
    return { fragments: [], action: "skipped" };
  }

  // After stripping work-mode, try splitting again on commas specifically
  // "Remote, SF, NYC" → strip "Remote" → ", SF, NYC" → "SF, NYC"
  // Now try comma-split: only if multiple comma-separated SHORT tokens
  const commaParts = strippedWorkMode
    .split(/\s*,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Use comma-split only if we got multiple fragments AND the original had
  // work-mode content stripped (to avoid splitting "Austin, Texas")
  if (commaParts.length > 1 && strippedWorkMode !== cleaned) {
    const geocodable = commaParts.filter((p) => !isPureRemote(p));
    if (geocodable.length === 0) {
      return { fragments: [], action: "skipped" };
    }
    return { fragments: geocodable, action: "split" };
  }

  // Step 4: Single fragment — check if anything changed
  const wasChanged = strippedWorkMode !== trimmed;
  return {
    fragments: [strippedWorkMode],
    action: wasChanged ? "cleaned" : "passthrough",
  };
}
