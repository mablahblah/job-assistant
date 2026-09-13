// Turns a job posting link into a key that two links pointing at one posting
// both produce, even when they carry different query strings. The key is what
// dedupe looks jobs up by, held in its own indexed column beside the link —
// the published link is only read, never altered, because stripping a link's
// query breaks it.
export function urlMatchKey(url: string): string | null {
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

  // The query string and the fragment are left out entirely — they are what
  // this key exists to ignore, since Adzuna hands back a fresh `se` value for
  // the same posting on every search. `host` rather than `hostname` keeps any
  // port, so two servers never collapse onto one key.
  return `${parsed.protocol}//${parsed.host}${path}`;
}
