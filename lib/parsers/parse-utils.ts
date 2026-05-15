// Shared utilities for page parsers — JSON-LD extraction, HTML helpers

import type { JobPostingLD } from "./types";

// Extract JobPosting JSON-LD from raw HTML string.
// Works on Playwright-rendered HTML, so JS-injected JSON-LD is captured.
export function extractJsonLd(html: string): JobPostingLD {
  const scriptRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      // JSON-LD can be a single object or wrapped in @graph array
      const nodes = data["@graph"] || [data];
      for (const node of nodes) {
        if (node["@type"] === "JobPosting") return node as JobPostingLD;
      }
    } catch {
      /* skip malformed JSON-LD blocks */
    }
  }
  return {};
}

// Strip HTML tags from a string, collapse whitespace
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
