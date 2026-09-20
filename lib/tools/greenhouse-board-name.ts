// Turns a Greenhouse job number into the Greenhouse board name behind it, by
// following Greenhouse's own redirect.
//
// Reached for when a job's link names no board — six employers host their
// Greenhouse postings on their own website, so the parser has nothing to read
// off the link itself. Guessing the board name from that website was wrong
// four times out of six — measured 2026-09-20, where datavant.com gives
// datavant2, ats.comparably.com gives stashinvest and gladly.ai gives
// sagansystems — so the redirect is the only source worth reading.
//
// Measured 2026-09-20: a request for
// boards.greenhouse.io/embed/job_app?token=7994649003 lands on
// job-boards.greenhouse.io/embed/job_app?for=moduscreate&token=7994649003, so
// the board name is the "for" value on the address the redirect ends at.
import { fetchWithTimeout } from "../utils/fetch-utils";
import { BROWSER_USER_AGENT } from "./page-fetcher";

// Follows Greenhouse's redirect and hands back the address it lands on.
// Returns null on a refused response rather than throwing, because a job
// number Greenhouse no longer holds answers 404 with no redirect at all —
// measured 2026-09-20 against token 7558673 — and a posting taken down
// between being collected and being read is an ordinary state, not a fault.
async function fetchFinalUrlFromGreenhouse(url: string): Promise<string | null> {
  const res = await fetchWithTimeout(url, {
    headers: { "user-agent": BROWSER_USER_AGENT },
  });
  if (!res.ok) {
    return null;
  }

  // fetch follows redirects by default, so res.url is already the address the
  // redirect landed on rather than the one that was requested.
  return res.url;
}

export async function boardNameFromJobId(
  jobId: string,
  // Substituted in tests so the board name can be proved without a network
  // request.
  fetchFinalUrl: (url: string) => Promise<string | null> = fetchFinalUrlFromGreenhouse
): Promise<string | null> {
  try {
    const finalUrl = await fetchFinalUrl(
      `https://boards.greenhouse.io/embed/job_app?token=${jobId}`
    );
    if (!finalUrl) {
      return null;
    }

    const board = new URL(finalUrl).searchParams.get("for");
    return board ? board : null;
  } catch {
    // A redirect that will not complete costs the board name, not the run —
    // the parser turns a missing board name into its own recorded failure,
    // exactly as it does for every other reason a posting cannot be read.
    return null;
  }
}
