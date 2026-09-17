// What one row of a job table on the dashboard is built from: the job as it is
// stored, and the employer it belongs to beside it.
//
// The two travel side by side rather than merged into one shape. The job shape
// already mirrors the Job row and the employer shape already mirrors the
// Company row, so merging them would create a third field list to keep in step
// with both. The job service's page reads hand this back, and the job table
// view takes it.
//
// Every field on the job is optional, because collection fills only what its
// source supplied. Every field on the employer can be empty, because scoring
// and the contact search each fill their own and leave the rest. The employer
// itself is absent where company association never matched one.
import type { CompanyRecord } from "../services/company-service";
import type { JobListEntry } from "./job-list-entry";

export interface JobRow {
  job: JobListEntry;
  company: CompanyRecord | null;
}
