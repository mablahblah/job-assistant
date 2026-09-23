// The Workday job-posting parser. Every Workday tenant answers a data
// address for each posting (measured 2026-09-23) that returns the posting as
// JSON, so this reads that address directly rather than a rendered page — no
// browser is opened. The employer name Workday sends alongside the posting
// is left out: it is a legal entity name, and using it would split one
// employer into two companies.
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { withFieldsFromDescription } from "../utils/description-fallback";
import {
  workdayBoardFromUrl,
  workdayJobPathFromUrl,
  partsFromWorkdayBoard,
  workdayPostingDataUrl,
  jobFieldsFromWorkdayPosting,
  type WorkdayPostingInfo,
} from "../utils/workday-fields";
import { BROWSER_USER_AGENT } from "../tools/page-fetcher";
import type { Parser } from "./parser";

interface WorkdayPostingResponse {
  jobPostingInfo: WorkdayPostingInfo;
  hiringOrganization: { name: string; url: string };
}

export const workdayParser: Parser = {
  name: "workday",

  async parse({ url }) {
    const board = workdayBoardFromUrl(url);
    const jobPath = workdayJobPathFromUrl(url);
    const parts = board ? partsFromWorkdayBoard(board) : null;
    if (!board || !jobPath || !parts) {
      // A link this parser cannot read is a parse error, not an empty read.
      throw new Error(`workday: could not read a board and job path from ${url}`);
    }
    const label = `workday (${board}/${jobPath})`;

    const res = await fetchWithTimeout(workdayPostingDataUrl(parts, jobPath), {
      headers: { "user-agent": BROWSER_USER_AGENT },
    });
    if (!res.ok) {
      // A closed posting answers 403.
      throw httpError(label, res.status);
    }

    const body = await safeJson<WorkdayPostingResponse>(res, label);
    const fields = jobFieldsFromWorkdayPosting(body.jobPostingInfo, board);
    return withFieldsFromDescription(fields, body.jobPostingInfo.jobDescription);
  },
};
