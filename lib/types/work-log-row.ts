// What one work log entry on the dashboard is built from: the entry as it was
// filed, and the employer behind it beside it.
//
// The entry holds the employer name and the job title copied at the moment it
// was written, so those two read from the entry and never from the employer.
// The employer is here only for the contact details the Texas Workforce
// Commission form asks for, which are not copied onto the entry because they
// are found later.
//
// The employer is absent in two cases the page treats alike: the job the entry
// names has since been deleted, and the job is linked to no employer at all.
// Either way the details were not found.
import type { CompanyRecord } from "../services/company-service";
import type { WorkLogRecord } from "../services/work-log-service";

export interface WorkLogRow {
  entry: WorkLogRecord;
  company: CompanyRecord | null;
}
