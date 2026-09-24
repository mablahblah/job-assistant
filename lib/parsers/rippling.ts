// The Rippling job-posting parser. Rippling's board page calls a public JSON
// API for each posting (measured 2026-09-24), so this reads that API
// directly rather than a rendered page — no browser is opened, unlike the
// page-reading parsers. Rippling publishes the employer's name on the job
// itself, so unlike Lever this parser makes no extra request for it.
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { withFieldsFromDescription } from "../utils/description-fallback";
import { jobFieldsFromRipplingJob, type RipplingJob } from "../utils/rippling-fields";
import { BROWSER_USER_AGENT } from "../tools/page-fetcher";
import type { Parser } from "./parser";

const jobUrl = (board: string, jobId: string) =>
  `https://api.rippling.com/platform/api/ats/v1/board/${board}/jobs/${jobId}`;

function extractRipplingBoardAndJobId(url: string): { board: string; jobId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // No host check here — a separate registry has already established the
  // link's owned domain is rippling.com before this is ever called. Query
  // (tracking values) and fragment are dropped by reading only the path.
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const board = segments[0];
  const jobsIndex = segments.indexOf("jobs");
  const jobId = jobsIndex === -1 ? undefined : segments[jobsIndex + 1];
  if (!board || !jobId) {
    return null;
  }

  return { board, jobId };
}

export const ripplingParser: Parser = {
  name: "rippling",

  async parse({ url }) {
    const identifiers = extractRipplingBoardAndJobId(url);
    if (!identifiers) {
      // A link this parser cannot read is a parse error, not an empty read.
      throw new Error(`rippling: could not read a board and job id from ${url}`);
    }
    const { board, jobId } = identifiers;
    const label = `rippling (${board}/${jobId})`;

    const res = await fetchWithTimeout(jobUrl(board, jobId), {
      headers: { "user-agent": BROWSER_USER_AGENT },
    });
    if (!res.ok) {
      // A closed job answers non-ok here — throwing leaves the job queued.
      throw httpError(label, res.status);
    }

    const job = await safeJson<RipplingJob>(res, label);
    const fields = jobFieldsFromRipplingJob(job, board);

    return withFieldsFromDescription(fields, fields.description ?? undefined);
  },
};
