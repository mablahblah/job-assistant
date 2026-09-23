// Maps a Workday job link into the board it belongs to and, alongside a
// posting's own fields, into the shape both a collector and a parser write
// to the database. Reading the board off a link and splitting it back apart
// both live here so the two callers can never disagree about part order.
import type { MappedJobFields } from "../types/job-list-entry";

const BOARD_SEPARATOR = ":";

export interface WorkdayBoardParts {
  company: string;
  dataCentre: string;
  site: string;
}

export interface WorkdayPostingInfo {
  title: string;
  jobDescription: string;
  location: string;
  additionalLocations?: string[];
  postedOn: string;
  startDate: string;
  timeType: string;
  jobReqId: string;
}

export interface WorkdayJobListing {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

export interface WorkdayJobListResponse {
  total?: number;
  jobPostings?: WorkdayJobListing[];
}

// Shared groundwork for both link readers: parses the URL, splits its path
// into segments, and finds where "job" sits in them. Everything either
// reader needs is a fixed number of steps from that position.
function parseWorkdayJobUrl(
  url: string
): { segments: string[]; jobIndex: number; host: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const jobIndex = segments.indexOf("job");
  if (jobIndex === -1) return null;
  return { segments, jobIndex, host: parsed.hostname };
}

export function workdayBoardFromUrl(url: string): string | null {
  const parsed = parseWorkdayJobUrl(url);
  if (!parsed) return null;
  // The site is whatever segment sits directly before "job" — a language
  // segment, when present, sits one further back and is never that segment.
  const site = parsed.segments[parsed.jobIndex - 1];
  if (!site) return null;
  const [company, dataCentre] = parsed.host.split(".");
  if (!company || !dataCentre) return null;
  return [company, dataCentre, site].join(BOARD_SEPARATOR);
}

export function partsFromWorkdayBoard(board: string): WorkdayBoardParts | null {
  const parts = board.split(BOARD_SEPARATOR);
  if (parts.length !== 3) return null;
  const [company, dataCentre, site] = parts;
  if (!company || !dataCentre || !site) return null;
  return { company, dataCentre, site };
}

export function workdayJobPathFromUrl(url: string): string | null {
  const parsed = parseWorkdayJobUrl(url);
  if (!parsed) return null;
  const rest = parsed.segments.slice(parsed.jobIndex + 1);
  // The apply page is not part of the posting; a query string is never in
  // the path segments to begin with.
  if (rest[rest.length - 1] === "apply") rest.pop();
  if (rest.length === 0) return null;
  return rest.join("/");
}

export function workdayPostingDataUrl(parts: WorkdayBoardParts, jobPath: string): string {
  return `https://${parts.company}.${parts.dataCentre}.myworkdayjobs.com/wday/cxs/${parts.company}/${parts.site}/job/${jobPath}`;
}

export function workdayJobListUrl(parts: WorkdayBoardParts): string {
  return `https://${parts.company}.${parts.dataCentre}.myworkdayjobs.com/wday/cxs/${parts.company}/${parts.site}/jobs`;
}

export function workdayPostingUrl(parts: WorkdayBoardParts, externalPath: string): string {
  return `https://${parts.company}.${parts.dataCentre}.myworkdayjobs.com/${parts.site}${externalPath}`;
}

export function jobFieldsFromWorkdayPosting(
  info: WorkdayPostingInfo,
  board: string
): MappedJobFields {
  const raw_location_list = [info.location, ...(info.additionalLocations ?? [])].filter(
    (location): location is string => Boolean(location)
  );
  // Workday's hiringOrganization name is the legal entity ("Circle Internet
  // Management Services LLC"), not the employer identity — using it here
  // would split one employer into two companies, so raw_company_name is
  // left unset and the board carries the employer's identity instead.
  return {
    raw_title: info.title,
    raw_company_slug: board,
    raw_location_list,
    raw_mode_list: [], // Workday publishes no mode field on a posting.
    posting_date: new Date(info.startDate),
    description: info.jobDescription || undefined,
  };
}

export function jobFieldsFromWorkdayListing(
  listing: WorkdayJobListing,
  board: string
): MappedJobFields {
  // The list gives an age ("Posted 30+ Days Ago"), not a real date, and no
  // description — both are left unset for the parser to fill in later.
  return {
    raw_title: listing.title,
    raw_company_slug: board,
    raw_location_list: listing.locationsText ? [listing.locationsText] : [],
    raw_mode_list: [],
  };
}
