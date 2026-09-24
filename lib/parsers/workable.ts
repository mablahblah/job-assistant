// The Workable job-posting parser, covering both of Workable's public
// sites: a company's own application site (apply.workable.com/{board}/j/{shortcode})
// and Workable's job search site (jobs.workable.com/view/{id}/{slug}). Both
// publish public JSON APIs, so this reads those directly rather than a
// rendered page — no browser is opened.
//
// The company site's posting never carries the employer's name, so this
// parser makes one extra request for the board's widget and reads the name
// off that. The search site's job already carries the employer's name, but
// never the employer's board, so the widget is asked again here — this time
// to check a guessed board name rather than to read a name off it. A guess
// only counts once its widget lists at least one job: every wrong guess
// measured on 2026-09-24 still answered ok with an empty board, so an ok
// answer alone proves nothing.
import { fetchWithTimeout, httpError, safeJson } from "../utils/fetch-utils";
import { withFieldsFromDescription } from "../utils/description-fallback";
import {
  jobFieldsFromWorkablePosting,
  jobFieldsFromWorkableSearchJob,
  type WorkablePosting,
  type WorkableSearchJob,
  type WorkableWidget,
} from "../utils/workable-fields";
import { registrableDomainFromUrl } from "../utils/registrable-domain";
import { BROWSER_USER_AGENT } from "../tools/page-fetcher";
import type { Parser } from "./parser";

const SEARCH_SITE_HOST = "jobs.workable.com";

const postingUrl = (board: string, shortcode: string) =>
  `https://apply.workable.com/api/v2/accounts/${board}/jobs/${shortcode}`;

const widgetUrl = (board: string) => `https://apply.workable.com/api/v1/widget/accounts/${board}`;

const searchJobUrl = (id: string) => `https://jobs.workable.com/api/v1/jobs/${id}`;

// A posting link is /{board}/j/{shortcode}, sometimes with a trailing slash.
// Workable sends a closed posting to a link with no "j" segment at all, such
// as /{board}/?not_found=true — that is read as unreadable, not empty.
function extractWorkableBoardAndShortcode(url: string): { board: string; shortcode: string } | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  const [board, marker, shortcode] = segments;
  if (!board || marker !== "j" || !shortcode) {
    return null;
  }
  return { board, shortcode };
}

// A search-site link is /view/{id}/{title-slug}, sometimes carrying tracking
// query values such as ?utm_source=adzuna that play no part in reading it.
function extractWorkableSearchJobId(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  const [marker, id] = segments;
  if (marker !== "view" || !id) {
    return null;
  }
  return id;
}

// Reads a board's widget, forgivingly: a board that cannot be reached,
// answers non-ok, or is not JSON simply yields nothing. Used both to read
// the company site's employer name and to test a search-site board guess.
async function readWorkableWidget(board: string): Promise<WorkableWidget | undefined> {
  try {
    const res = await fetchWithTimeout(widgetUrl(board), {
      headers: { "user-agent": BROWSER_USER_AGENT },
    });
    if (!res.ok) {
      return undefined;
    }
    return await safeJson<WorkableWidget>(res, `workable widget (${board})`);
  } catch {
    return undefined;
  }
}

async function employerNameFromWorkableWidget(board: string): Promise<string | undefined> {
  const widget = await readWorkableWidget(board);
  return widget?.name;
}

// Turns the employer's name into a slug guess, lowercased with every run of
// non a-z0-9 characters collapsed to one dash and dashes trimmed off both
// ends — "Pet Lab Co." → "pet-lab-co".
function dashSlugGuess(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The same idea with no dashes at all — "Pet Lab Co." → "petlabco".
function noDashSlugGuess(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// The first label of the employer's website's registrable domain —
// "https://thepetlabco.com" → "thepetlabco". No website, or a domain this
// cannot be read from, adds no guess.
function domainLabelGuess(website: string | undefined): string | null {
  if (!website) {
    return null;
  }
  const domain = registrableDomainFromUrl(website);
  if (!domain) {
    return null;
  }
  return domain.split(".")[0];
}

// The search site never names the employer's board, so this builds an
// ordered list of guesses to check against the widget — skipping any blank
// guess and any guess that repeats an earlier one.
function workableBoardGuesses(job: WorkableSearchJob): string[] {
  const candidates = [
    dashSlugGuess(job.company.title),
    noDashSlugGuess(job.company.title),
    domainLabelGuess(job.company.website) ?? "",
  ];
  const guesses: string[] = [];
  for (const guess of candidates) {
    if (!guess || guesses.includes(guess)) {
      continue;
    }
    guesses.push(guess);
  }
  return guesses;
}

// Tries each guess in turn, one at a time, until one is proven — its widget
// answers ok, is JSON, and lists at least one job. A guess that fails any of
// that simply is not proven; guessing moves on rather than failing the
// parse. No guess proven at all means no board is reported.
async function findWorkableBoard(job: WorkableSearchJob): Promise<string | undefined> {
  for (const guess of workableBoardGuesses(job)) {
    const widget = await readWorkableWidget(guess);
    if (widget && widget.jobs.length > 0) {
      return guess;
    }
  }
  return undefined;
}

async function parseWorkableCompanySite(url: string) {
  const identifiers = extractWorkableBoardAndShortcode(url);
  if (!identifiers) {
    // A link this parser cannot read is a parse error, not an empty read.
    throw new Error(`workable: could not read a board and job code from ${url}`);
  }
  const { board, shortcode } = identifiers;
  const label = `workable (${board}/${shortcode})`;

  const res = await fetchWithTimeout(postingUrl(board, shortcode), {
    headers: { "user-agent": BROWSER_USER_AGENT },
  });
  if (!res.ok) {
    throw httpError(label, res.status);
  }

  const posting = await safeJson<WorkablePosting>(res, label);
  const fields = jobFieldsFromWorkablePosting(posting, board);

  const name = await employerNameFromWorkableWidget(board);
  if (name) {
    fields.raw_company_name = name;
  }

  return withFieldsFromDescription(fields, fields.description ?? undefined);
}

async function parseWorkableSearchSite(url: string) {
  const id = extractWorkableSearchJobId(url);
  if (!id) {
    // A link this parser cannot read is a parse error, not an empty read.
    throw new Error(`workable: could not read a job id from ${url}`);
  }
  const label = `workable search (${id})`;

  const res = await fetchWithTimeout(searchJobUrl(id), {
    headers: { "user-agent": BROWSER_USER_AGENT },
  });
  if (!res.ok) {
    throw httpError(label, res.status);
  }

  const job = await safeJson<WorkableSearchJob>(res, label);
  const fields = jobFieldsFromWorkableSearchJob(job);

  const board = await findWorkableBoard(job);
  if (board) {
    fields.raw_company_slug = board;
  }

  return withFieldsFromDescription(fields, fields.description ?? undefined);
}

export const workableParser: Parser = {
  name: "workable",

  async parse({ url }) {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      throw new Error(`workable: could not read a board and job code from ${url}`);
    }
    if (host === SEARCH_SITE_HOST) {
      return parseWorkableSearchSite(url);
    }
    return parseWorkableCompanySite(url);
  },
};
