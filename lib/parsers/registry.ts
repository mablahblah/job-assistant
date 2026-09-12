// The list of every job-posting parser a run has, keyed by the domain its
// source owns. A parser joins the pipeline by being listed here and nowhere
// else — the parser equivalent of lib/collectors/registry.ts.
//
// Keyed by owned domain, not exact host, on purpose. Greenhouse serves from
// boards.greenhouse.io, job-boards.greenhouse.io and
// job-boards.eu.greenhouse.io — all one greenhouse.io — and a hand-written
// host list would have missed the .eu variant, which appears exactly once in
// the live data. The case that decided this runs the other way: a platform
// giving every employer its own web address (meredith.wd5.myworkdayjobs.com)
// reads as many unrelated singletons under exact-host matching, which hides
// the one parser worth building. Collapsing to owned domain is what makes a
// failing platform countable. This replaces a legacy registry that kept
// hand-listed hosts plus a Greenhouse wildcard regex.
import { registrableDomainFromUrl } from "../registrable-domain";
import { ashbyParser } from "./ashby";
import { dribbbleParser } from "./dribbble";
import { greenhouseParser } from "./greenhouse";
import { leverParser } from "./lever";
import type { Parser } from "./types";

export const PARSERS_BY_DOMAIN: Record<string, Parser> = {
  "greenhouse.io": greenhouseParser,
  "lever.co": leverParser,
  "ashbyhq.com": ashbyParser,
  "dribbble.com": dribbbleParser,
};

// Looks up the parser that owns a link's domain. Returns null for anything
// that is not a web address, a bare IP, localhost, or a domain no entry
// names — never throws.
export function parserForUrl(url: string): Parser | null {
  const domain = registrableDomainFromUrl(url);

  if (domain === null) {
    return null;
  }

  return PARSERS_BY_DOMAIN[domain] ?? null;
}
