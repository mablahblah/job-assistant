// The UltiPro job-posting parser. The link itself is the posting page:
// (measured 2026-09-23) an UltiPro posting page embeds the whole job as a
// CandidateOpportunityDetail(...) call in a script tag, so a plain request
// reads everything needed — no browser is opened. An UltiPro link carries
// the job's only identity in its query string.
import { fetchWithTimeout, httpError } from "../utils/fetch-utils";
import { withFieldsFromDescription } from "../utils/description-fallback";
import {
  ultiproBoardFromUrl,
  ultiproPostingFromPage,
  jobFieldsFromUltiproPosting,
} from "../utils/ultipro-fields";
import { BROWSER_USER_AGENT } from "../tools/page-fetcher";
import type { Parser } from "./parser";

export const ultiproParser: Parser = {
  name: "ultipro",

  async parse({ url }) {
    const board = ultiproBoardFromUrl(url);
    if (!board) {
      // A link this parser cannot read is a parse error, not an empty read.
      throw new Error(`ultipro: could not read a board from ${url}`);
    }
    const label = `ultipro (${board})`;

    const res = await fetchWithTimeout(url, {
      headers: { "user-agent": BROWSER_USER_AGENT },
    });
    if (!res.ok) {
      throw httpError(label, res.status);
    }

    const html = await res.text();
    const posting = ultiproPostingFromPage(html);
    if (!posting) {
      // The page held no job to read.
      throw new Error(`${label}: page held no job to read`);
    }

    const fields = jobFieldsFromUltiproPosting(posting, board);
    return withFieldsFromDescription(fields, posting.Description);
  },
};
