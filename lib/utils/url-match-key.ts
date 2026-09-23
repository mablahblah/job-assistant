// Turns a job posting link into a key that two links pointing at one posting
// both produce, even when they carry different query strings. The key is what
// dedupe looks jobs up by, held in its own indexed column beside the link —
// the published link is only read, never altered, because stripping a link's
// query breaks it.
//
// Most query values are tracking noise: Adzuna hands back a fresh `se` value
// on every search, and utm_source just says which board a click came from.
// A handful of sources do the opposite — UltiPro puts a job's only identity
// in its `opportunityid` query value, with nothing distinguishing in the
// path. `identifyingQueryValues` names the query values worth keeping for a
// given link; every other query value is still dropped. Every caller passes
// this list explicitly. An empty list drops the whole query string.
export function urlMatchKey(
  url: string,
  identifyingQueryValues: readonly string[],
): string | null {
  let parsed: URL;
  try {
    // The built-in parser rejects anything that is not a real URL — plain
    // words, an empty string, a host written with no scheme — without a
    // hand-written check, and lowercases the host on the way through.
    parsed = new URL(url);
  } catch {
    return null;
  }

  // A trailing slash is dropped, so "/jobs/123/" and "/jobs/123" key the same.
  // A bare path of "/" strips to nothing, which is what leaves a link with no
  // path at all keying to its scheme and host alone. The rest of the path
  // keeps the case the source wrote, because a posting id can be
  // case-sensitive and flattening it would key two different jobs the same.
  const path = parsed.pathname.replace(/\/$/, "");

  // `host` rather than `hostname` keeps any port, so two servers never
  // collapse onto one key. The fragment is left out entirely — it never
  // carries identity, only where a page scrolls to.
  const base = `${parsed.protocol}//${parsed.host}${path}`;

  // Compared without regard to case, so a name written as "opportunityId" in
  // one place and "opportunityid" in another still matches the same rule.
  const identifyingNames = new Set(
    identifyingQueryValues.map((name) => name.toLowerCase()),
  );

  // Reading and writing through URLSearchParams keeps values encoded the
  // same way regardless of how the source link encoded them, so two links
  // for the same job produce byte-identical keys.
  const kept = new URLSearchParams();
  for (const [name, value] of parsed.searchParams) {
    if (identifyingNames.has(name.toLowerCase())) {
      kept.append(name.toLowerCase(), value);
    }
  }

  if ([...kept].length === 0) {
    return base;
  }

  // Sorted by name so it does not matter what order the link wrote its query
  // values in — the same identifying values always produce the same key.
  kept.sort();
  return `${base}?${kept.toString()}`;
}
