// Extracts the hostname from a URL. If the string is not a valid URL, returns
// it unchanged rather than throwing an error. This allows the calling code to
// handle both properly-formed links and plain strings without crashing.
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Compares two URLs by their exact hostname. A subdomain is treated as a
// different host: boards.greenhouse.io is not the same as greenhouse.io. This
// is what resolution asks after each hop, to know whether the walk left the
// host it came from.
export function isSameDomain(url1: string, url2: string): boolean {
  return extractDomain(url1) === extractDomain(url2);
}
