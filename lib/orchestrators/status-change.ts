// Runs a status change the user made by hand: the status and the work log
// entry first, then the search that fills in the employer's contact details.
//
// The order is the point. Every status change and every work log entry in a
// batch is written before the first search starts, and two handlers called in
// a fixed order is what makes that structural rather than a comment somebody
// can move.
//
// It also answers a batch problem. Waiting for each search was reasoned about
// for one job and turns ten new employers into ten network calls in a row.
// Doing the legal writes first means a command cut short costs searches and
// never costs a filing — a work log entry is a Texas Workforce Commission
// record that cannot be regenerated once its week has passed.
//
// No trace rows anywhere in this flow. A status change made by hand is not a
// job passing through a pipeline step.

import type { JobService } from "../services/job-service";
import type { CompanyService } from "../services/company-service";
import type { WorkLogService } from "../services/work-log-service";
import type { CompanySearch } from "../tools/company-search";
import { changeStatuses, type StatusChange } from "../handlers/status-change";
import { enrichCompanies, type EnrichmentTarget } from "../handlers/enrichment";
import type { ChangedJob } from "../types/changed-job";
import type { EnrichedCompany } from "../types/enriched-company";

export interface RunStatusChangeOptions {
  jobs: JobService;
  companies: CompanyService;
  workLog: WorkLogService;
  search: CompanySearch;
  priorityList: readonly string[];
  identifyingQueryValues: readonly string[];
  now: Date;
}

export interface RunStatusChangeResult {
  changes: ChangedJob[];
  companies: EnrichedCompany[];
  warnings: string[];
}

export async function runStatusChange(
  changes: StatusChange[],
  options: RunStatusChangeOptions
): Promise<RunStatusChangeResult> {
  const {
    jobs,
    companies,
    workLog,
    search,
    priorityList,
    identifyingQueryValues,
    now,
  } = options;

  const changed = await changeStatuses(changes, {
    jobs,
    companies,
    workLog,
    priorityList,
    identifyingQueryValues,
  });

  // Only a job whose entry was really written sends its employer to the
  // search. A job set aside because its employer has no name, a job no row
  // holds, and a status that writes no entry all have no filing for those
  // contact details to appear on.
  //
  // The place travels along with it, because a common employer name finds the
  // wrong business on its own.
  // One employer named twice in a submission is one employer to look up. A
  // search that filled something in stops the second lookup on its own, but a
  // search that found nothing leaves the employer open on purpose — so
  // without this, ten jobs at one employer nobody can find would be paid for
  // ten times in a single run. The first job's matched place is the one used.
  const targets: EnrichmentTarget[] = [];
  const named = new Set<string>();
  for (const change of changed.changes) {
    if (!change.entry_written || change.company_id === null) continue;
    if (named.has(change.company_id)) continue;
    named.add(change.company_id);
    targets.push({ company_id: change.company_id, place: change.place });
  }

  const searched = await enrichCompanies(targets, { companies, search, now });

  return {
    changes: changed.changes,
    companies: searched.companies,
    warnings: [...changed.warnings, ...searched.warnings],
  };
}
