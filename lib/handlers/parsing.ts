// The parsing step's handler: given a job list whose links have already been
// resolved, reads each job's posting with the parser that owns its domain and
// folds whatever fields it finds onto the entry. A job with no covering
// parser is set aside as unparseable rather than read blind, and one job's
// read failing never stops the rest of the list from being tried.
import type { CollectionIssue } from "../types/collection-issue";
import type { JobListEntry } from "../types/job-list-entry";
import { parserForUrl } from "../parsers/registry";
import type { Parser } from "../parsers/parser";
import { registrableDomainFromUrl } from "../utils/registrable-domain";
import type { TraceService } from "../services/trace-service";

export interface ParseJobsOptions {
  // Substitution point that lets the step be tested offline against stand-in
  // parsers. Left out, it is the real registry.
  parserFor?: (url: string) => Parser | null;
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface ParseJobsResult {
  jobs: JobListEntry[];
  warnings: CollectionIssue[];
}

// The reason codes a failed parse can carry on its trace row.
type ParseFailureReason = "no_parser_for_domain" | "parser_errored" | "nothing_parsed";

// One job after an attempted parse: the entry to return, and the row the
// attempt earned. A successful read carries no reason; a failed one carries
// no fields. detail is the full resolved link, so a failure can be chased
// back to the exact address it happened on, while the domain beside it is
// what gets counted.
interface ParsedEntry {
  job: JobListEntry;
  event: "job_parsed" | "parse_failed";
  reason?: ParseFailureReason;
  domain?: string;
  detail?: string;
}

// Sets a job aside unread: no parser could be found to look at it, so rather
// than guess from a stale aggregator copy it is pulled from the queue for the
// Web View's disqualified list to fix by hand.
function markUnparseable(
  job: JobListEntry,
  domain: string | null,
  resolvedUrl: string | null | undefined
): ParsedEntry {
  return {
    job: { ...job, status: "unparseable", is_parsed: false },
    event: "parse_failed",
    reason: "no_parser_for_domain",
    domain: domain ?? undefined,
    detail: resolvedUrl ?? undefined,
  };
}

// Runs one job's resolved link through whichever parser owns its domain, and
// reports back what happened so the caller can write a trace row without
// having to re-derive why a job's fields did or did not change.
async function parseSingleJob(
  job: JobListEntry,
  parserFor: (url: string) => Parser | null
): Promise<ParsedEntry> {
  const resolvedUrl = job.resolved_url;
  const domain = resolvedUrl ? registrableDomainFromUrl(resolvedUrl) : null;

  // No link at all, or a link that is not a web address: there is no domain
  // to look a parser up by, so this is unreadable exactly like a domain no
  // parser names.
  if (!resolvedUrl || !domain) {
    return markUnparseable(job, domain, resolvedUrl);
  }

  const parser = parserFor(resolvedUrl);
  if (!parser) {
    return markUnparseable(job, domain, resolvedUrl);
  }

  try {
    const result = await parser.parse({ url: resolvedUrl });

    // An empty answer means the parser ran and read nothing at all. That is a
    // failed read rather than a thin posting, so the job stays where it was
    // and the next run tries again.
    if (Object.keys(result).length === 0) {
      return {
        job: { ...job, is_parsed: false },
        event: "parse_failed",
        reason: "nothing_parsed",
        domain,
        detail: resolvedUrl,
      };
    }

    return {
      job: {
        ...job,
        ...result,
        // Status is not one of the fields a parse excludes by type, so it is
        // carried forward on purpose rather than left to whatever the parser
        // happened to return.
        status: job.status,
        is_parsed: true,
        parser: parser.name,
      },
      event: "job_parsed",
    };
  } catch {
    // A parser throwing is a temporary outage, not a verdict on the job — it
    // keeps whatever status and queue position it already had, because an
    // outage must not push a job out of the backlog permanently.
    return {
      job: { ...job, is_parsed: false },
      event: "parse_failed",
      reason: "parser_errored",
      domain,
      detail: resolvedUrl,
    };
  }
}

export async function parseJobs(
  jobs: JobListEntry[],
  options: ParseJobsOptions
): Promise<ParseJobsResult> {
  const { parserFor = parserForUrl, trace, runId, step } = options;

  const parsedJobs: JobListEntry[] = jobs.slice();

  // Sequential and guarded: each job is tried in turn, and one job's failure
  // is caught inside parseSingleJob so it never costs the jobs after it.
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (!job) continue;

    const parsed = await parseSingleJob(job, parserFor);
    parsedJobs[index] = parsed.job;

    // A trace row is keyed by job id and collector, so a job carrying
    // neither has nothing to key its record on. All three of trace, runId
    // and step are needed as well: a step handed only some of them still
    // does its work and stays silent, which is what lets the same function
    // run outside a job search.
    if (!job.id || !job.collector) continue;

    if (trace && runId !== undefined && step !== undefined) {
      await trace.write({
        run_id: runId,
        job_id: job.id,
        step,
        event: parsed.event,
        collector: job.collector,
        reason: parsed.reason,
        domain: parsed.domain,
        detail: parsed.detail,
      });
    }
  }

  // This step raises none today. The field is here because every step's
  // result carries it.
  return { jobs: parsedJobs, warnings: [] };
}
