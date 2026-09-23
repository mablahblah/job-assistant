// Maps an UltiPro job link into the board it belongs to and, alongside a
// posting's own fields, into the shape both a collector and a parser write
// to the database. Reading the board off a link and splitting it back apart
// both live here so the two callers can never disagree about part order.
//
// The board is lower-cased on the way in: stored links are lower case, but
// UltiPro's own addresses spell the same path in capitals ("JobBoard",
// "OpportunityDetail"), and one board must resolve to one value regardless
// of which case reached us.
//
// The posting page carries no JSON-LD block. Measured 2026-09-23: a plain
// request returns the finished page with the whole job embedded as a JSON
// object literal passed to `CandidateOpportunityDetail(...)`, so that script
// is where the posting is read from.
import type { MappedJobFields } from "../types/job-list-entry";

const BOARD_SEPARATOR = ":";
const JOBBOARD_SEGMENT = "jobboard";
const DETAIL_MARKER = "CandidateOpportunityDetail(";

export interface UltiproBoardParts {
  companyCode: string;
  boardId: string;
}

export interface UltiproLocation {
  LocalizedName?: string;
  Address?: {
    City?: string;
    State?: { Code?: string; Name?: string };
    Country?: { Code?: string; Name?: string };
  };
}

export interface UltiproPosting {
  Id: string;
  Title: string;
  Description?: string;
  PostedDate: string;
  UpdatedDate?: string;
  Locations?: UltiproLocation[];
}

export interface UltiproJobListResponse {
  opportunities?: UltiproPosting[];
  totalCount?: number;
}

export function ultiproBoardFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const jobBoardIndex = segments.findIndex((segment) => segment.toLowerCase() === JOBBOARD_SEGMENT);
  if (jobBoardIndex === -1) return null;
  const companyCode = segments[jobBoardIndex - 1];
  const boardId = segments[jobBoardIndex + 1];
  if (!companyCode || !boardId) return null;
  return [companyCode, boardId].join(BOARD_SEPARATOR).toLowerCase();
}

export function partsFromUltiproBoard(board: string): UltiproBoardParts | null {
  const parts = board.split(BOARD_SEPARATOR);
  if (parts.length !== 2) return null;
  const [companyCode, boardId] = parts;
  if (!companyCode || !boardId) return null;
  return { companyCode, boardId };
}

export function ultiproJobListUrl(parts: UltiproBoardParts): string {
  return `https://recruiting.ultipro.com/${parts.companyCode}/jobboard/${parts.boardId}/jobboardview/loadsearchresults`;
}

export function ultiproPostingUrl(parts: UltiproBoardParts, opportunityId: string): string {
  // Lowercase URL to match the canonical form that deduplication and resolvers expect
  return `https://recruiting.ultipro.com/${parts.companyCode}/jobboard/${parts.boardId}/opportunitydetail?opportunityid=${opportunityId}`;
}

// Scans forward from the object literal's opening brace to its matching
// close, tracking string literals (and escaped characters inside them) so a
// brace, `)`, or `;` in the HTML description doesn't end the scan early.
function balancedJsonObjectAfter(html: string, start: number): string | null {
  if (html[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

export function ultiproPostingFromPage(html: string): UltiproPosting | null {
  const markerIndex = html.indexOf(DETAIL_MARKER);
  if (markerIndex === -1) return null;
  let start = markerIndex + DETAIL_MARKER.length;
  while (start < html.length && /\s/.test(html[start])) start++;
  const jsonText = balancedJsonObjectAfter(html, start);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText) as UltiproPosting;
  } catch {
    return null;
  }
}

// A location's own city/state/country, joined; falls back to its plain
// name when the posting gives no address (e.g. a "Remote - US" location).
function locationStringFromUltiproLocation(location: UltiproLocation): string | undefined {
  const address = location.Address;
  const parts = [address?.City, address?.State?.Code, address?.Country?.Name].filter(
    (part): part is string => Boolean(part)
  );
  if (parts.length > 0) return parts.join(", ");
  return location.LocalizedName || undefined;
}

export function jobFieldsFromUltiproPosting(posting: UltiproPosting, board: string): MappedJobFields {
  const raw_location_list = (posting.Locations ?? [])
    .map(locationStringFromUltiproLocation)
    .filter((location): location is string => Boolean(location));
  return {
    raw_title: posting.Title,
    raw_company_slug: board,
    raw_location_list,
    raw_mode_list: [], // UltiPro publishes no work-mode field on a posting.
    posting_date: new Date(posting.PostedDate),
    posting_updated_date: posting.UpdatedDate ? new Date(posting.UpdatedDate) : undefined,
    description: posting.Description || undefined,
  };
}
