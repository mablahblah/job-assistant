// True when a string field holds real data. Empty means null, undefined, "",
// or "?" — "?" is the sentinel parsers write for an unknown salary.
export function hasFieldValue(val: string | undefined | null): boolean {
  return val != null && val !== "" && val !== "?";
}
