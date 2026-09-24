// The SmartRecruiters job-posting parser. SmartRecruiters publishes a public
// JSON API for each posting, so this reads that API directly rather than a
// rendered page — no browser is opened, unlike the page-reading parsers. The
// posting address answers Bad Request to the full slug after the identifier
// (measured 2026-09-24), so only the number before the first dash is sent.
// SmartRecruiters publishes the employer's name, so unlike Lever this parser
// makes no extra request for it.
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { withFieldsFromDescription } from "../utils/description-fallback";
import {
  jobFieldsFromSmartRecruitersPosting,
  type SmartRecruitersPosting,
} from "../utils/smartrecruiters-fields";
import { BROWSER_USER_AGENT } from "../tools/page-fetcher";
import type { Parser } from "./parser";

const postingUrl = (board: string, postingId: string) =>
  `https://api.smartrecruiters.com/v1/companies/${board}/postings/${postingId}`;

function extractSmartRecruitersBoardAndId(
  url: string,
): { board: string; postingId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // No host check here — a separate registry has already established the
  // link's owned domain is smartrecruiters.com before this is ever called.
  // Query (tracking values) and fragment are dropped by reading only the
  // path.
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return null;
  }

  // The second segment is often the identifier followed by the job title,
  // e.g. "744000147869999-senior-manager-product-design" — only the number
  // before the first dash is a posting id the API will accept.
  const postingId = segments[1].split("-")[0];
  if (!postingId) {
    return null;
  }

  return { board: segments[0], postingId };
}

export const smartrecruitersParser: Parser = {
  name: "smartrecruiters",

  async parse({ url }) {
    const identifiers = extractSmartRecruitersBoardAndId(url);
    if (!identifiers) {
      // A link this parser cannot read is a parse error, not an empty read.
      throw new Error(`smartrecruiters: could not read a board and posting id from ${url}`);
    }
    const { board, postingId } = identifiers;
    const label = `smartrecruiters (${board}/${postingId})`;

    const res = await fetchWithTimeout(postingUrl(board, postingId), {
      headers: { "user-agent": BROWSER_USER_AGENT },
    });
    if (!res.ok) {
      // A closed posting answers 404 here — throwing leaves the job queued.
      throw httpError(label, res.status);
    }

    const posting = await safeJson<SmartRecruitersPosting>(res, label);
    const fields = jobFieldsFromSmartRecruitersPosting(posting, board);

    return withFieldsFromDescription(fields, fields.description ?? undefined);
  },
};
