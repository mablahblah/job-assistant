// The shared contract every collector implements, whatever its source — a
// search API, an ATS board, or a scraped page. The orchestrator knows only
// this shape and never a collector's internals.
import type { JobListEntry } from "../job-list-entry";
import type { SettingsService } from "../settings-service";

// What a collector is handed to do one run's work.
export interface CollectorContext {
  settings: SettingsService;
  // How many jobs to stop after. Infinity means collect everything.
  limit: number;
}

// What a collector hands back, however its run went. An API call that threw
// and a page that would not load arrive here identically, so the orchestrator
// branches on neither.
export interface CollectorResult {
  jobs: JobListEntry[];
  errors: string[];
  warnings: string[];
}

export interface Collector {
  // The collector's single canonical name. It labels every job, error, and
  // warning the run records against this collector.
  name: string;
  collect(context: CollectorContext): Promise<CollectorResult>;
}
