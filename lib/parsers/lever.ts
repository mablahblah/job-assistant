// The Lever job-posting parser. Lever publishes a public JSON API for each
// posting, so this reads that API directly rather than a rendered page — no
// browser is opened, unlike the page-reading parsers. The one exception is
// the employer's name: Lever's posting API never carries it, so this parser
// makes one extra request for the board page and reads the name off its
// <title>.
import { nameFromBoardTitle, titleFromHtml } from "../utils/board-title-name";
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { withFieldsFromDescription } from "../utils/description-fallback";
import { jobFieldsFromLeverPosting, type LeverPosting } from "../utils/lever-fields";
import { BROWSER_USER_AGENT, fetchPageHtml } from "../tools/page-fetcher";
import type { Parser } from "./parser";

const postingUrl = (slug: string, postingId: string) =>
  `https://api.lever.co/v0/postings/${slug}/${postingId}`;

const boardUrl = (slug: string) => `https://jobs.lever.co/${slug}`;

export function extractLeverSlugAndId(url: string): { slug: string; postingId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // No host check here — a separate registry has already established the
  // link's owned domain is lever.co before this is ever called.
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return null;
  }

  return { slug: segments[0], postingId: segments[1] };
}

export const leverParser: Parser = {
  name: "lever",

  async parse({ url }) {
    const identifiers = extractLeverSlugAndId(url);
    if (!identifiers) {
      // A link this parser cannot read is a parse error, not an empty read.
      throw new Error(`lever: could not read a board slug and posting id from ${url}`);
    }
    const { slug, postingId } = identifiers;
    const label = `lever (${slug}/${postingId})`;

    const res = await fetchWithTimeout(postingUrl(slug, postingId), {
      headers: { "user-agent": BROWSER_USER_AGENT },
    });
    if (!res.ok) {
      throw httpError(label, res.status);
    }

    const posting = await safeJson<LeverPosting>(res, label);
    const fields = jobFieldsFromLeverPosting(posting, slug);

    // Lever's API never carries the employer's name, so it is read off the
    // board page's title instead. This is deliberately never cached — search
    // terms narrow each board down to a handful of jobs, so the repeated
    // fetch is small, and caching costs nothing to add later if that changes.
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

    return withFieldsFromDescription(fields, posting.descriptionPlain || posting.description);
  },
};
