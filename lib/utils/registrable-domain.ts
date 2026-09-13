import { parse } from "tldts";

// Extracts the domain a person or company registered — one label above the
// public suffix — from a URL. Returns null if the string is not a valid web
// address, and null if the host has no owned domain to give (a bare IP, a
// bare public suffix like co.uk, or localhost). Never throws.
//
// This exists so the pipeline can match a job's resolved link to a parser by
// the domain its source owns, not by its exact host. Greenhouse serves job
// boards from three different hosts that must all collapse to greenhouse.io,
// and a platform like Workday gives every employer its own subdomain that
// must collapse to one countable domain rather than read as unrelated
// singletons. Taking the last two labels of the host is not enough — it
// misreads adzuna.co.uk as co.uk — so the public suffix list is needed.
export function registrableDomainFromUrl(url: string): string | null {
  // tldts is lenient about non-web schemes (it will pull a domain out of a
  // mailto: link), so a URL check comes first: only http/https addresses
  // count as web addresses here.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return null;
  }

  return parse(url).domain;
}
