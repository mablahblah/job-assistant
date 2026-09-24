// The BambooHR job-posting parser. A careers page answers with a rendered
// page unless asked for data, so this asks its detail endpoint for JSON
// directly (measured 2026-09-24) — no browser is opened, unlike the
// page-reading parsers. No reply here ever names the employer, so unlike
// Lever this parser makes no extra request for it — the aggregator's name
// stands.
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { withFieldsFromDescription } from "../utils/description-fallback";
import {
  jobFieldsFromBambooHrJob,
  type BambooHrDetailResponse,
} from "../utils/bamboohr-fields";
import { rawSalaryFromPayText } from "../utils/raw-salary-from-text";
import { BROWSER_USER_AGENT } from "../tools/page-fetcher";
import type { Parser } from "./parser";

const detailUrl = (board: string, jobId: string) =>
  `https://${board}.bamboohr.com/careers/${jobId}/detail`;

function extractBambooHrBoardAndJob(url: string): { board: string; jobId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // No host check here — a separate registry has already established the
  // link's owned domain is bamboohr.com before this is ever called. Query
  // (tracking values) and fragment are dropped by reading only the host and
  // path.
  const board = parsed.hostname.split(".")[0];
  if (!board) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const careersIndex = segments.indexOf("careers");
  const jobId = careersIndex === -1 ? undefined : segments[careersIndex + 1];
  if (!jobId) {
    return null;
  }

  return { board, jobId };
}

export const bamboohrParser: Parser = {
  name: "bamboohr",

  async parse({ url }) {
    const identifiers = extractBambooHrBoardAndJob(url);
    if (!identifiers) {
      // A link this parser cannot read is a parse error, not an empty read.
      throw new Error(`bamboohr: could not read a board and job id from ${url}`);
    }
    const { board, jobId } = identifiers;
    const label = `bamboohr (${board}/${jobId})`;

    const res = await fetchWithTimeout(detailUrl(board, jobId), {
      headers: { "user-agent": BROWSER_USER_AGENT, accept: "application/json" },
    });
    if (!res.ok) {
      // A closed job answers non-ok here — throwing leaves the job queued.
      throw httpError(label, res.status);
    }

    const reply = await safeJson<BambooHrDetailResponse>(res, label);
    const job = reply.result.jobOpening;
    const fields = jobFieldsFromBambooHrJob(job, board);

    // The free-text pay field is known to be pay, so it is read with no
    // currency sign needed (measured 2026-09-24, shortcut job 40:
    // "145k-185k"). The description is the fallback only when this field is
    // missing or states no range.
    const rawSalary = job.compensation ? rawSalaryFromPayText(job.compensation) : null;
    const withPay = rawSalary ? { ...fields, raw_salary: rawSalary } : fields;

    return withFieldsFromDescription(withPay, withPay.description ?? undefined);
  },
};
