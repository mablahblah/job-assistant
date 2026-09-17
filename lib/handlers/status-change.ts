// Writes a status the user set by hand, and the work log entry that status
// calls for. This is the first thing in the app a job search never starts:
// everything before it runs inside a run, and this runs because the user said
// a job moved.
//
// A work log entry is a legal filing for the Texas Workforce Commission that
// cannot be regenerated once its week has passed, so everything here is built
// around writing it exactly once or failing loudly enough to be acted on.
//
// The trigger is the arriving status, never which branch the job service
// took. That service holds a status-only write path that runs only when the
// job is already active, so a job going from backlog to app. sent takes a
// different path entirely. Hanging the entry on that branch would skip the
// first entry for every job and catch only later moves — silent, systematic,
// and hitting the commonest case there is.
//
// No trace rows are written. A status change made by hand is not a job
// passing through a pipeline step, and counting it would put work the
// pipeline never did into the funnel.

import type { JobService } from "../services/job-service";
import type { CompanyRecord, CompanyService } from "../services/company-service";
import type { WorkLogService } from "../services/work-log-service";
import { activityFromStatus } from "../utils/work-log-activity";
import { entryTitleFromJob } from "../utils/work-log-title";
import { messageFromThrown } from "../utils/thrown-message";

export interface StatusChange {
  job_id: string;
  status: string;
  // Supplied on a second run, for a job the first run asked about.
  company_name?: string;
}

export type ChangeOutcome =
  | "changed"
  | "no_such_job"
  | "needs_company_name"
  | "no_title"
  | "entry_failed";

export interface ChangedJob {
  job_id: string;
  status: string;
  outcome: ChangeOutcome;
  entry_written: boolean;
  company_id: string | null;
  company_name: string | null;
  // The place this job's location matched, carried back because the search
  // that runs next puts it into the query — a common employer name finds the
  // wrong business on its own. A job moved straight out of the backlog was
  // never classified and matched no place, so this is often empty.
  place: string | null;
}

export interface ChangeStatusesOptions {
  jobs: JobService;
  companies: CompanyService;
  workLog: WorkLogService;
  priorityList: readonly string[];
}

export interface ChangeStatusesResult {
  changes: ChangedJob[];
  warnings: string[];
}

interface Applied {
  change: ChangedJob;
  warning?: string;
}

// The question is whether a usable name exists, not whether an employer is
// attached. Every hiring board the app polls creates an employer row holding
// a slug and no name, so the obvious check passes while the name is still
// blank — and the entry would then name a blank employer, which is the one
// thing the asking exists to prevent.
function hasUsableName(
  company: CompanyRecord | null
): company is CompanyRecord & { name: string } {
  return company !== null && typeof company.name === "string" && company.name.trim() !== "";
}

async function applyChange(change: StatusChange, options: ChangeStatusesOptions): Promise<Applied> {
  const { jobs, companies, workLog, priorityList } = options;

  // Read before writing. The job service creates a row when asked to update
  // one it cannot find, and a status change carries no collection date, so
  // that create refuses with a message about a missing column — which names
  // the wrong fault when the real answer is that no job holds the id.
  const job = await jobs.findById(change.job_id);
  if (job === null) {
    return { change: reported(change, "no_such_job", false, null, null) };
  }

  const jobId = job.id ?? change.job_id;
  const place = job.location_match_place ?? null;

  // Read from the wording rather than from a second list. A status with no
  // wording writes no entry, so this one lookup answers both questions and
  // the two cannot disagree.
  const activity = activityFromStatus(change.status);

  // The employer is settled before the status is written. A supplied name
  // finds or creates its own employer and the job is linked there; the
  // nameless employer is left exactly as it stands, along with its other
  // jobs. Re-linking those was proposed and withdrawn: a nameless employer
  // standing behind an aggregator is not one employer, and those are
  // probably jobs for different companies.
  //
  // The link is written first because the job service freezes an active job
  // against every field but its status.
  let employer: CompanyRecord | null = null;
  const supplied = change.company_name;
  if (typeof supplied === "string" && supplied.trim() !== "") {
    const { company } = await companies.create({ name: supplied });
    await jobs.update({ id: jobId, company_id: company.id }, priorityList);
    employer = company;
  } else if (job.company_id) {
    employer = await companies.findById(job.company_id);
  }

  if (activity !== undefined && !hasUsableName(employer)) {
    return { change: reported(change, "needs_company_name", false, null, place) };
  }

  const title = entryTitleFromJob(job);

  // The status is written before the entry. Nothing can undo either write —
  // no database transaction exists anywhere in this codebase — so the
  // protection is the order plus a failure the user can see and act on.
  try {
    await jobs.update({ id: jobId, status: change.status }, priorityList);
  } catch (thrown) {
    return {
      change: reported(change, "entry_failed", false, employer, place),
      warning: `Job ${jobId}: the status was not written (${messageFromThrown(thrown)})`,
    };
  }

  if (activity === undefined) {
    return { change: reported(change, "changed", false, employer, place) };
  }

  if (!title) {
    return { change: reported(change, "no_title", false, employer, place) };
  }

  try {
    await workLog.write({
      job_id: jobId,
      // The name check above returned for every employer without one, so by
      // here the employer holds a name.
      company_name: hasUsableName(employer) ? employer.name : "",
      job_title: title,
      activity,
    });
    return { change: reported(change, "changed", true, employer, place) };
  } catch (thrown) {
    return {
      change: reported(change, "entry_failed", false, employer, place),
      warning: `Job ${jobId}: the status was written but the work log entry was not (${messageFromThrown(thrown)})`,
    };
  }
}

function reported(
  change: StatusChange,
  outcome: ChangeOutcome,
  entryWritten: boolean,
  employer: CompanyRecord | null,
  place: string | null
): ChangedJob {
  return {
    job_id: change.job_id,
    status: change.status,
    outcome,
    entry_written: entryWritten,
    company_id: employer?.id ?? null,
    company_name: employer?.name ?? null,
    place,
  };
}

export async function changeStatuses(
  changes: StatusChange[],
  options: ChangeStatusesOptions
): Promise<ChangeStatusesResult> {
  const result: ChangeStatusesResult = { changes: [], warnings: [] };

  // Every failure is caught per entry, so one bad job never costs the others.
  for (const change of changes) {
    const applied = await applyChange(change, options);
    result.changes.push(applied.change);
    if (applied.warning) result.warnings.push(applied.warning);
  }

  return result;
}
