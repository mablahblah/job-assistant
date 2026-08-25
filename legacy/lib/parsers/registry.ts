// Greenlit domain registry — maps ATS domains to their page parsers

import type { ParserFn, PipelineJob } from "./types";

// Greenhouse uses custom subdomains (e.g. acme.greenhouse.io, job-boards.greenhouse.io).
// Match any hostname ending with greenhouse.<tld>.
const GREENHOUSE_PATTERN = /\.?greenhouse\.\w+$/i;

// Internal parser registry — populated by registerParser() at startup
const registry: Record<string, ParserFn> = {};

// Register a parser for a greenlit domain
export function registerParser(domain: string, parser: ParserFn): void {
  registry[domain] = parser;
}

// Get the parser for a domain, or null if none registered
export function getParser(domain: string): ParserFn | null {
  return registry[domain] ?? null;
}

// Reset registry — used in tests to isolate state between runs
export function clearRegistry(): void {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
}

// Single matching function: given a hostname, return the registry key
// of the parser that handles it, or null. Checks in order:
// 1. Exact match against registry keys
// 2. Greenhouse wildcard (*.greenhouse.*) → resolves to boards.greenhouse.io
// 3. Subdomain match (www.adzuna.com → adzuna.com)
export function matchDomain(domain: string): string | null {
  if (!domain) return null;
  const lower = domain.toLowerCase();

  // 1. Exact match
  if (registry[lower]) return lower;

  // 2. Greenhouse wildcard — any *.greenhouse.* resolves to the registered Greenhouse parser
  if (GREENHOUSE_PATTERN.test(lower)) {
    return registry["boards.greenhouse.io"] ? "boards.greenhouse.io" : null;
  }

  // 3. Subdomain match — check if this is a subdomain of any registered domain
  for (const key of Object.keys(registry)) {
    if (lower.endsWith(`.${key}`)) return key;
  }

  return null;
}

// Check if a URL is on a greenlit domain. Returns the registry key or null.
// Convenience wrapper over matchDomain that handles URL parsing.
export function isGreenlitDomain(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return matchDomain(hostname);
}

// Route pipeline jobs to their parsers by final domain.
// Groups by registry key (so getParser() works on the keys).
export function routeByDomain(jobs: PipelineJob[]): {
  matched: Record<string, PipelineJob[]>;
  unmatched: PipelineJob[];
} {
  const matched: Record<string, PipelineJob[]> = {};
  const unmatched: PipelineJob[] = [];

  for (const job of jobs) {
    const key = matchDomain(job.finalDomain);
    if (key) {
      if (!matched[key]) matched[key] = [];
      matched[key].push(job);
    } else {
      unmatched.push(job);
    }
  }

  return { matched, unmatched };
}
