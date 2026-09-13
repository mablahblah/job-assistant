// The Ashby job-posting parser. Ashby publishes a public JSON API for each
// job board, so this reads that API directly rather than driving a browser —
// the legacy Ashby parser used Playwright to scrape a React data blob out of
// the rendered page; this one reads api.ashbyhq.com instead, the same
// endpoint the Ashby collector reads. No browser is opened anywhere here.
import { jobFieldsFromAshbyPosting, type AshbyJobBoardResponse } from "../utils/ashby-fields";
import { nameFromBoardTitle, titleFromHtml } from "../utils/board-title-name";
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { withFieldsFromDescription } from "../utils/description-fallback";
import { BROWSER_USER_AGENT, fetchPageHtml } from "../tools/page-fetcher";
import { urlMatchKey } from "../utils/url-match-key";
import type { Parser } from "./parser";

const postingUrl = (slug: string) =>
  `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;

const boardUrl = (slug: string) => `https://jobs.ashbyhq.com/${slug}`;

// Reads the board slug off an Ashby link, shaped
// https://jobs.ashbyhq.com/{slug}/{postingId} — the slug is the first path
// segment. The link's domain has already been established by a registry
// before this runs, so there is no host check here.
export function extractAshbySlug(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  return segments[0];
}

export const ashbyParser: Parser = {
  name: "ashby",

  async parse({ url }) {
    const slug = extractAshbySlug(url);
    if (!slug) {
      // A link this parser cannot read is a parse error, not an empty read.
      throw new Error(`ashby: could not read a board slug from ${url}`);
    }
    const label = `ashby (${slug})`;

    const res = await fetchWithTimeout(postingUrl(slug), {
      headers: { "user-agent": BROWSER_USER_AGENT },
    });
    if (!res.ok) {
      throw httpError(label, res.status);
    }

    const board = await safeJson<AshbyJobBoardResponse>(res, label);

    // Ashby postings carry no stable id — the board only identifies a
    // posting by its jobUrl, and query strings drift between the stored
    // link and the board's own copy — so postings are matched on a link
    // match key rather than exact text. A null key on either side must
    // never be treated as matching another null key.
    const wantedKey = urlMatchKey(url);
    const posting = board.jobs.find((candidate) => {
      const candidateKey = urlMatchKey(candidate.jobUrl);
      return candidateKey !== null && wantedKey !== null && candidateKey === wantedKey;
    });

    if (!posting) {
      // A posting no longer on the board is a parse that ran and found
      // nothing, not an error — this leaves the job in the backlog to
      // retry, and there is no name lookup worth making for it.
      return {};
    }

    const fields = jobFieldsFromAshbyPosting(posting, slug);

    // Ashby's API never carries the employer's name at all — verified live
    // on 2026-09-12 against the hinge-health board, whose answer holds only
    // jobs and apiVersion — so it is read off the board page's title
    // instead. This is deliberately never cached — search terms narrow each
    // board down to a handful of jobs, so the repeated fetch is small, and
    // caching costs nothing to add later if that changes.
    try {
      const html = await fetchPageHtml(boardUrl(slug));
      const title = titleFromHtml(html);
      const name = title ? nameFromBoardTitle(title) : null;
      if (name) {
        fields.raw_company_name = name;
      }
    } catch {
      // A board page that will not load costs the name, not the parse — a
      // missing employer name is an ordinary state the app already handles.
    }

    return withFieldsFromDescription(fields, posting.descriptionPlain || posting.descriptionHtml);
  },
};
