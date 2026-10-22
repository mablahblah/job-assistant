// The shared contract every collector implements, whatever its source — a
// search API, an ATS board, or a scraped page. The orchestrator knows only
// this shape and never a collector's internals.
import type { JobListEntry } from "../types/job-list-entry";
import type { SettingsService } from "../services/settings-service";
import type { AtsSlugService } from "../services/ats-slug-service";
import type { LastSuccessService } from "../services/last-success-service";

// What a collector is handed to do one run's work.
export interface CollectorContext {
  settings: SettingsService;
  // Where an ATS collector finds the boards it polls. Every collector is
  // handed it, the way every collector is handed the settings, so the
  // orchestrator holds one shape rather than one per kind of collector.
  atsSlugs: AtsSlugService;
  // How many jobs to stop after. Infinity means collect everything.
  limit: number;
  // The run's collection time, the same instant written into every job's
  // collected_at. A collector that asks a source only for jobs posted since
  // its last search measures against this instant and reads no clock.
  collectedAt: Date;
  // Where a collector reads when each of its searches last worked. Every
  // collector is handed it, the way every collector is handed the settings,
  // so the orchestrator holds one shape. A collector can only find a time; a
  // later step writes it.
  lastSuccesses: Pick<LastSuccessService, "find">;
}

// What a collector hands back, however its run went. An API call that threw
// and a page that would not load arrive here identically, so the orchestrator
// branches on neither.
export interface CollectorResult {
  jobs: JobListEntry[];
  errors: string[];
  warnings: string[];
  // The names of the collector's searches that worked this run, for a
  // collector that remembers when each search last worked. Left out by
  // collectors that keep no such times.
  workedSearches?: string[];
}

export interface Collector {
  // The collector's single canonical name. It labels every job, error, and
  // warning the run records against this collector.
  name: string;
  collect(context: CollectorContext): Promise<CollectorResult>;
}
