// Attaches every job in the list to the company it belongs to, looking up by
// board slug first and by the name's match key second, and creating a company
// where neither finds one. It runs before dedupe because dedupe matches on
// company, and a newly collected job has no company row yet.
//
// It reaches the company table only through the service it is handed, so it
// opens no database of its own and a fake serves its tests. It recomputes on
// every pass and never skips a job that already carries a company, which is
// what lets a later parsing pass correct a company the first pass got wrong.
import type { CompanyRecord, CompanyService } from "../company-service";
import type { TraceService } from "../trace-service";
import type { CollectionIssue } from "../collection-issue";
import type { JobListEntry } from "../job-list-entry";
import { companyMatchKey } from "../company-match-key";
import { associationWarnings, type AssociationWarning } from "../association-warnings";

export interface AssociateCompaniesOptions {
  companies: CompanyService;
  trace?: TraceService;
  runId?: string;
  step?: string;
}

export interface AssociateCompaniesResult {
  jobs: JobListEntry[];
  warnings: CollectionIssue[];
}

// The longest real job title measured is 131 characters and the longest real
// company name is 50, so 200 fits every genuine value while still cutting a
// description a collector bug put in the wrong field.
const MAX_DETAIL_LENGTH = 200;

function truncate(value: string): string {
  return value.length > MAX_DETAIL_LENGTH ? value.slice(0, MAX_DETAIL_LENGTH) : value;
}

// A usable name is one companyMatchKey can turn into a real key. A name that
// is nothing but punctuation keys to "" — SQLite treats an empty string as an
// ordinary unique-index value, so a second such company would throw rather
// than simply fail to match. Treat that as no name at all. The key comes back
// alongside the name so the lookup never has to build it a second time.
function usableName(name: string | null | undefined): { name: string; matchKey: string } | null {
  if (!name) return null;
  const matchKey = companyMatchKey(name);
  return matchKey ? { name, matchKey } : null;
}

// One trace row this step wants written for a job: the event, its reason, and
// the bare value the row's detail carries, already truncated.
interface AssociationTraceRow {
  event: string;
  reason: string;
  detail: string;
}

// An AssociationWarning without its collector. The per-job work does not know
// whether this job is even eligible to warn — a job carrying no id or no
// collector has nothing to key a record on — so the caller adds it.
type WarningInput =
  | { kind: "no_name_for_lookup"; slug: string }
  | { kind: "company_name_clash"; name: string; target: CompanyRecord; heldBy: CompanyRecord };

interface AssociateJobResult {
  job: JobListEntry;
  traceRows: AssociationTraceRow[];
  warning?: WarningInput;
}

interface CompanyMatch {
  company: CompanyRecord;
  reason: "matched_by_slug" | "matched_by_name" | "company_created";
  // Only a slug match can land on a company that still holds no name — one
  // found by name key, or one just created, already has one.
  matchedBySlug: boolean;
}

// Works out the company for a single job and what should be recorded about
// it. Does not touch the job it is given.
async function associateJob(
  job: JobListEntry,
  companies: CompanyService
): Promise<AssociateJobResult> {
  const slug = job.raw_company_slug ?? undefined;
  const usable = usableName(job.raw_company_name);
  const traceRows: AssociationTraceRow[] = [];

  let match: CompanyMatch | undefined;

  // A slug is the stronger identity: a job carrying one has been told which
  // board it came from rather than having to be matched on spelling.
  if (slug) {
    const bySlug = await companies.findBySlug(slug);
    if (bySlug) {
      match = { company: bySlug, reason: "matched_by_slug", matchedBySlug: true };
    }
  }

  // No slug, or the slug matched nothing: fall through to the name lookup
  // rather than creating, so a board a parser found but the seed never
  // polled does not split an employer the table already holds.
  if (!match && usable) {
    const byName = await companies.findByMatchKey(usable.matchKey);
    if (byName) {
      match = { company: byName, reason: "matched_by_name", matchedBySlug: false };
    } else {
      const { company, created } = await companies.create({ name: usable.name });
      // A refused create hands back the company already blocking it — that
      // is a match, not a creation, so it must not count as one. Counting
      // company_created rows is how a run reports the companies it added.
      match = {
        company,
        reason: created ? "company_created" : "matched_by_name",
        matchedBySlug: false,
      };
    }
  }

  if (!match) {
    // Neither the slug nor a usable name found anywhere to attach this job.
    // It still travels the rest of the pipeline without a company.
    const failedSlug = slug ?? "";
    traceRows.push({
      event: "association_failed",
      reason: "no_name_for_lookup",
      detail: truncate(failedSlug),
    });
    return {
      job: { ...job },
      traceRows,
      warning: { kind: "no_name_for_lookup", slug: failedSlug },
    };
  }

  // The association row always comes first; a fill or clash row follows it,
  // never replaces it, so a job that came out with a company always has
  // exactly one company_associated row for this pass.
  const detailValue = match.matchedBySlug ? slug ?? "" : usable?.name ?? "";
  traceRows.push({
    event: "company_associated",
    reason: match.reason,
    detail: truncate(detailValue),
  });

  let warning: WarningInput | undefined;

  // A company holding no name takes one from the first job that supplies
  // one. A name a company already holds is never overwritten, so nothing
  // logs a name change on every run for the rest of its life.
  if (match.matchedBySlug && usable && !match.company.name) {
    const fillResult = await companies.fillName(match.company.id, usable.name);
    if (fillResult.filled) {
      traceRows.push({
        event: "company_updated",
        reason: "company_name_filled",
        detail: truncate(usable.name),
      });
    } else if (fillResult.heldBy) {
      // Another company already holds this name. Leave the job on the
      // company it matched and report the pair, because merging two rows
      // naming one employer is the user's call.
      traceRows.push({
        event: "company_update_failed",
        reason: "company_name_clash",
        detail: truncate(usable.name),
      });
      warning = {
        kind: "company_name_clash",
        name: usable.name,
        target: match.company,
        heldBy: fillResult.heldBy,
      };
    }
  }

  return { job: { ...job, company_id: match.company.id }, traceRows, warning };
}

export async function associateCompanies(
  jobs: JobListEntry[],
  options: AssociateCompaniesOptions
): Promise<AssociateCompaniesResult> {
  const { companies, trace, runId, step } = options;
  const associatedJobs: JobListEntry[] = [];
  const warnings: AssociationWarning[] = [];

  // Sequential and awaited, never Promise.all: two jobs naming the same
  // absent employer must land on one company, which only holds if the
  // second job's lookup runs after the first job's create has finished.
  for (const job of jobs) {
    const { job: associatedJob, traceRows, warning } = await associateJob(job, companies);
    associatedJobs.push(associatedJob);

    // A trace row and a warning are both keyed by job id and collector, so a
    // job carrying neither has nothing to key its record on.
    if (!job.id || !job.collector) continue;

    if (warning) warnings.push({ ...warning, collector: job.collector });

    for (const row of traceRows) {
      // All three of trace, runId and step are needed before a row is
      // written. A step handed only some of them still does its work and
      // stays silent, which is what lets the same function run outside a
      // job search.
      if (trace && runId !== undefined && step !== undefined) {
        await trace.write({
          run_id: runId,
          job_id: job.id,
          step,
          event: row.event,
          collector: job.collector,
          reason: row.reason,
          detail: row.detail,
        });
      }
    }
  }

  return { jobs: associatedJobs, warnings: associationWarnings(warnings) };
}
