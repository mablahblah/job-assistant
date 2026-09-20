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
//
// A lookup is two steps, the owned-domain list first and only then a parser's
// own claim, and that order is the whole point. Measured 2026-09-20, all 309
// postings already on a Greenhouse address also carry a Greenhouse job
// number, so a claim checked first would pull a Lever, Ashby or Dribbble link
// away from the parser that owns its domain.
import { registrableDomainFromUrl } from "../utils/registrable-domain";
import { ashbyParser } from "./ashby";
import { dribbbleParser } from "./dribbble";
import { greenhouseParser } from "./greenhouse";
import { leverParser } from "./lever";
import type { Parser } from "./parser";

export const PARSERS_BY_DOMAIN: Record<string, Parser> = {
  "greenhouse.io": greenhouseParser,
  "lever.co": leverParser,
  "ashbyhq.com": ashbyParser,
  "dribbble.com": dribbbleParser,
};

// Looks up the parser for a link. Returns null for a link no entry owns and
// no parser claims, and never throws — a parser's claim is responsible for
// answering a string that is not a web address without throwing.
export function parserForUrl(url: string): Parser | null {
  const domain = registrableDomainFromUrl(url);

  if (domain !== null && domain in PARSERS_BY_DOMAIN) {
    return PARSERS_BY_DOMAIN[domain];
  }

  // Reached only where the list above placed nothing, which includes a string
  // that is not a web address at all. A link another parser already owns by
  // its domain is never offered around.
  for (const parser of Object.values(PARSERS_BY_DOMAIN)) {
    if (parser.claims?.(url)) {
      return parser;
    }
  }

  return null;
}
