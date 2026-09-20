// The Greenhouse job-posting parser. Greenhouse publishes a public JSON API
// for each posting, so this reads that API directly rather than a rendered
// page — no browser is opened, unlike the page-reading parsers.
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { withFieldsFromDescription } from "../utils/description-fallback";
import { jobFieldsFromGreenhousePosting, type GreenhousePosting } from "../utils/greenhouse-fields";
import { BROWSER_USER_AGENT } from "../tools/page-fetcher";
import { boardNameFromJobId } from "../tools/greenhouse-board-name";
import { registrableDomainFromUrl } from "../utils/registrable-domain";
import type { Parser } from "./parser";

// pay_transparency=true matters: without it the board withholds the pay field
// even where one exists, so a parser that dropped the flag would read no pay
// and nothing would say so.
const postingUrl = (slug: string, jobId: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}?content=true&pay_transparency=true`;

// Reads the board slug and posting id out of a Greenhouse link. Two shapes
// exist: a shared board (boards.greenhouse.io/{slug}/jobs/{id}, and its
// job-boards.greenhouse.io / job-boards.eu.greenhouse.io equivalents) carries
// the slug in the path, right before "jobs". An employer's own address
// ({company}.greenhouse.io/jobs/{id}) has "jobs" as the FIRST path segment,
// so there the slug comes from the hostname instead. Which shape a link is
// gets decided by where "jobs" sits in the path — not by matching the host,
// because greenhouseIdentifiersForUrl only calls this once it has confirmed
// the link's domain is greenhouse.io.
//
// That gate is load-bearing. Measured 2026-09-20, pinterestcareers.com puts
// "jobs" first in its own path too (/jobs/7684577/...), which is exactly this
// function's signal for an employer's own Greenhouse address. Read that way
// it hands back the slug "www" rather than the real board, "pinterest" — so a
// link on any other domain must never reach this function.
export function extractGreenhouseSlugAndId(url: string): { slug: string; jobId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const jobsIndex = segments.indexOf("jobs");
  if (jobsIndex === -1) {
    return null;
  }

  const jobId = segments[jobsIndex + 1];
  if (!jobId) {
    return null;
  }

  if (jobsIndex === 0) {
    // Employer's own address: "jobs" leads the path, so the slug is the
    // first label of the hostname instead of a path segment.
    const slug = parsed.hostname.split(".")[0];
    if (!slug) {
      return null;
    }
    return { slug, jobId };
  }

  const slug = segments[jobsIndex - 1];
  return { slug, jobId };
}

// Reads the gh_jid query value off a link. Six employers host their Greenhouse
// postings on their own careers page rather than a Greenhouse address, so the
// link names no board — but every one of those addresses carries this value,
// a Greenhouse job number, which is what makes the board recoverable at all.
export function greenhouseJobIdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // searchParams.get answers null for a missing value and an empty string for
  // "?gh_jid=", and neither is a job number.
  const jobId = parsed.searchParams.get("gh_jid");
  if (!jobId) {
    return null;
  }

  return jobId;
}

// Decides where this link's board name comes from, and the link's domain is
// what decides it.
//
// A Greenhouse address already names its board, so it is read straight off
// the link and no lookup is spent. Measured 2026-09-20, all 309 postings
// already on a Greenhouse address also carry a gh_jid, so recovering the
// board from the job number would cost a request on every one of them for a
// name the link was holding all along.
//
// Any other address names no board, so the job number is the only way to one.
// Trying the path first and falling back to the job number would not do: a
// Pinterest careers link reads as a Greenhouse address under a path-first
// rule and never falls back, giving the wrong board silently.
export async function greenhouseIdentifiersForUrl(
  url: string,
  // Substituted in tests so the choice can be proved without a network
  // request.
  recoverBoardName: (jobId: string) => Promise<string | null> = boardNameFromJobId
): Promise<{ slug: string; jobId: string } | null> {
  if (registrableDomainFromUrl(url) === "greenhouse.io") {
    return extractGreenhouseSlugAndId(url);
  }

  const jobId = greenhouseJobIdFromUrl(url);
  if (!jobId) {
    return null;
  }

  const slug = await recoverBoardName(jobId);
  if (!slug) {
    return null;
  }

  return { slug, jobId };
}

export const greenhouseParser: Parser = {
  name: "greenhouse",

  // The registry owns no entry for brex.com, moduscreate.com,
  // pinterestcareers.com, datavant.com, ats.comparably.com or gladly.ai, so a
  // link on any of them reaches no parser by website alone. A Greenhouse job
  // number on the link is what says the posting is Greenhouse's, whatever
  // website it is being shown on. Measured 2026-09-20: of 120 jobs set aside
  // for want of a reader, 7 carry one.
  claims: (url: string) => greenhouseJobIdFromUrl(url) !== null,

  async parse({ url }) {
    const identifiers = await greenhouseIdentifiersForUrl(url);
    if (!identifiers) {
      // A link this parser cannot read is a parse error, not an empty read.
      throw new Error(`greenhouse: could not read a board slug and posting id from ${url}`);
    }
    const { slug, jobId } = identifiers;
    const label = `greenhouse (${slug}/${jobId})`;

    const res = await fetchWithTimeout(postingUrl(slug, jobId), {
      headers: { "user-agent": BROWSER_USER_AGENT },
    });
    if (!res.ok) {
      throw httpError(label, res.status);
    }

    const posting = await safeJson<GreenhousePosting>(res, label);

    // Verified live on 2026-09-12 against the stripe board: the single-posting
    // endpoint returns exactly the same object shape as the board-list
    // endpoint — first_published, company_name and all — so the shared
    // mapper reads it unchanged and no second request is needed to find the
    // employer's name.
    const fields = jobFieldsFromGreenhousePosting(posting, slug);

    return withFieldsFromDescription(fields, posting.content);
  },
};
