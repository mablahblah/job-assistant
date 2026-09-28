// The parsing step's handler: given a job list whose links have already been
// resolved, reads each job's posting with the parser that owns its domain,
// falling back to a general-purpose parser when there is no dedicated
// parser, the dedicated one fails, or there was never anything but the
// fallback to ask in the first place. A job that ends up with no usable
// location from either read is set aside as unparseable rather than kept
// alive without a place to work from. One job's read failing never stops
// the rest of the list from being tried.
import type { CollectionIssue } from "../types/collection-issue";
import type { JobListEntry } from "../types/job-list-entry";
import { parserForUrl } from "../parsers/registry";
import type { Parser, ParseResult } from "../parsers/parser";
import { generalParser } from "../parsers/general";
import { registrableDomainFromUrl } from "../utils/registrable-domain";
import { splitLocation } from "../utils/split-location";
import type { TraceService } from "../services/trace-service";

export interface ParseJobsOptions {
  // Substitution point that lets the step be tested offline against stand-in
  // parsers. Left out, it is the real registry.
  parserFor?: (url: string) => Parser<ParseResult> | null;
  // The parser every failed or unowned job is handed to as a safety net.
  // Left out, it is the real general-purpose parser.
  fallbackParser?: Parser<ParseResult>;
  // Handed to every parser call alongside the url, so a parser that needs a
  // browser-rendered page or a fixed "now" gets both the same way a real job
  // search would supply them.
  readRenderedPage?: (url: string) => Promise<string>;
  referenceInstant?: Date;
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface ParseJobsResult {
  jobs: JobListEntry[];
  warnings: CollectionIssue[];
}

type ParseFailureReason = "dead_page" | "no_location";

interface ParsedEntry {
  job: JobListEntry;
  event: "job_parsed" | "parsing_failed";
  reason?: ParseFailureReason;
  domain?: string;
  detail?: string;
}

// A job "has a place" once one of its raw location strings yields at least
// one real place — splitLocation already strips mode words like "Remote"
// and empty punctuation, so whatever survives is what counts.
function jobHasPlace(job: JobListEntry): boolean {
  const locations = job.raw_location_list ?? [];
  return locations.some((raw) => splitLocation(raw).places.length > 0);
}

// The rule every job passes through once parsing is done trying to read it:
// keep it if it has a place to work from, set it aside if it doesn't.
function applyLocationRule(job: JobListEntry, domain: string | null, resolvedUrl: string | null | undefined): ParsedEntry {
  if (jobHasPlace(job)) {
    return { job: { ...job, is_parsed: true }, event: "job_parsed" };
  }
  return {
    job: { ...job, status: "unparseable", is_parsed: false },
    event: "parsing_failed",
    reason: "no_location",
    domain: domain ?? undefined,
    detail: resolvedUrl ?? undefined,
  };
}

interface ParseSingleJobOptions {
  parserFor: (url: string) => Parser<ParseResult> | null;
  fallbackParser: Parser<ParseResult>;
  readRenderedPage?: (url: string) => Promise<string>;
  referenceInstant?: Date;
}

async function parseSingleJob(job: JobListEntry, options: ParseSingleJobOptions): Promise<ParsedEntry> {
  const { parserFor, fallbackParser, readRenderedPage, referenceInstant } = options;
  const resolvedUrl = job.resolved_url;
  const domain = resolvedUrl ? registrableDomainFromUrl(resolvedUrl) : null;

  // No web link to read at all: there is nothing to ask a parser, so only
  // the location the job already carries decides its fate.
  if (!resolvedUrl || !domain) {
    return applyLocationRule(job, domain, resolvedUrl);
  }

  // The dedicated parser gets first try, as long as one is actually owned
  // and it isn't just the fallback wearing the registry's hat — in that
  // case there's nothing to try before the fallback itself.
  const dedicated = parserFor(resolvedUrl);
  if (dedicated && dedicated !== fallbackParser) {
    try {
      const result = await dedicated.parse({ url: resolvedUrl, readRenderedPage, referenceInstant });
      if (!("dead" in result) && Object.keys(result).length > 0) {
        // A dedicated read is trusted as-is: today's status and the
        // location rule stay untouched, because the source that owns this
        // domain already knows what kind of posting it's looking at.
        return {
          job: { ...job, ...result, status: job.status, is_parsed: true, parser: dedicated.name },
          event: "job_parsed",
        };
      }
      // Empty, or not a usable read — fall through to the general parser
      // below. Nothing is recorded for this attempt.
    } catch {
      // Same: a throw here is silent, the general parser gets the next try.
    }
  }

  // The general parser is the safety net: it runs whenever there was no
  // dedicated parser, the dedicated one didn't pan out, or the dedicated one
  // is itself the fallback.
  try {
    const result = await fallbackParser.parse({ url: resolvedUrl, readRenderedPage, referenceInstant });
    if ("dead" in result) {
      return {
        job: { ...job, status: "expired", is_parsed: true, parser: fallbackParser.name },
        event: "job_parsed",
        reason: "dead_page",
      };
    }
    if (Object.keys(result).length > 0) {
      // added_location_list is additive, not a replacement: it names places
      // found on the page that the job's own location list didn't have, so
      // it's appended rather than spread over the job like every other
      // field. A raw_location_list included as ordinary job data still
      // replaces the job's, the same as any other field.
      const { added_location_list, ...fields } = result;
      const merged: JobListEntry = {
        ...job,
        ...fields,
        status: job.status,
        is_parsed: true,
        parser: fallbackParser.name,
      };
      if (added_location_list) {
        merged.raw_location_list = [...(job.raw_location_list ?? []), ...added_location_list];
      }
      return applyLocationRule(merged, domain, resolvedUrl);
    }
    // Empty answer: the page was read but nothing usable came back.
  } catch {
    // The page was refused outright. Either way — refused or empty — a job
    // never gets expired for this; it just falls to the location rule.
  }

  return applyLocationRule(job, domain, resolvedUrl);
}

export async function parseJobs(jobs: JobListEntry[], options: ParseJobsOptions): Promise<ParseJobsResult> {
  const { parserFor = parserForUrl, fallbackParser = generalParser, readRenderedPage, referenceInstant, trace, runId, step } = options;
  const parsedJobs: JobListEntry[] = jobs.slice();
  // Sequential and guarded: each job is tried in turn, and one job's failure
  // is caught inside parseSingleJob so it never costs the jobs after it.
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (!job) continue;
    const parsed = await parseSingleJob(job, { parserFor, fallbackParser, readRenderedPage, referenceInstant });
    parsedJobs[index] = parsed.job;
    // A trace row is keyed by job id and collector, so a job carrying
    // neither has nothing to key its record on. All three of trace, runId
    // and step are needed as well: a step handed only some of them still
    // does its work and stays silent, which is what lets the same function
    // run outside a job search.
    if (!job.id || !job.collector) continue;
    if (trace && runId !== undefined && step !== undefined) {
      await trace.write({ run_id: runId, job_id: job.id, step, event: parsed.event, collector: job.collector, reason: parsed.reason, domain: parsed.domain, detail: parsed.detail });
    }
  }
  // This step raises none today. The field is here because every step's
  // result carries it.
  return { jobs: parsedJobs, warnings: [] };
}
