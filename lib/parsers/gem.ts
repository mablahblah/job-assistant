// The Gem job-posting parser. Gem publishes a public JSON API for each
// posting, so this reads that API directly rather than a rendered page — no
// browser is opened, unlike the page-reading parsers. Gem's API never
// carries the employer's name (measured 2026-09-24), so unlike Lever this
// parser makes no extra request for it — the aggregator's name stands.
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { withFieldsFromDescription } from "../utils/description-fallback";
import { jobFieldsFromGemPosting, type GemPosting } from "../utils/gem-fields";
import { BROWSER_USER_AGENT } from "../tools/page-fetcher";
import type { Parser } from "./parser";

const postingUrl = (board: string, postingId: string) =>
  `https://api.gem.com/job_board/v0/${board}/job_posts/${postingId}`;

function extractGemBoardAndId(url: string): { board: string; postingId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // No host check here — a separate registry has already established the
  // link's owned domain is gem.com before this is ever called. Query
  // (tracking values) and fragment are dropped by reading only the path.
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return null;
  }

  return { board: segments[0], postingId: segments[1] };
}

export const gemParser: Parser = {
  name: "gem",

  async parse({ url }) {
    const identifiers = extractGemBoardAndId(url);
    if (!identifiers) {
      // A link this parser cannot read is a parse error, not an empty read.
      throw new Error(`gem: could not read a board and posting id from ${url}`);
    }
    const { board, postingId } = identifiers;
    const label = `gem (${board}/${postingId})`;

    const res = await fetchWithTimeout(postingUrl(board, postingId), {
      headers: { "user-agent": BROWSER_USER_AGENT },
    });
    if (!res.ok) {
      // A closed posting answers 404 here — throwing leaves the job queued.
      throw httpError(label, res.status);
    }

    const posting = await safeJson<GemPosting>(res, label);
    const fields = jobFieldsFromGemPosting(posting, board);

    return withFieldsFromDescription(fields, posting.content_plain || posting.content);
  },
};
