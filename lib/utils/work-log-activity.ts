// The wording a work log entry carries for the status that produced it. The
// three phrases are the Texas Workforce Commission's own language, so they
// are fixed values rather than labels anyone may reword: a filing is rejected
// on wording the form does not recognize.
//
// Wording is what makes an entry writable, so a status with no wording writes
// no entry. That is why every status but the three answers with nothing.

import { WORK_LOG_STATUSES, isWorkLogStatus } from "./job-status";

export type WorkLogActivity = "Applied for job" | "Had phone screen" | "Had interview";

type WorkLogStatus = (typeof WORK_LOG_STATUSES)[number];

// Typed against the one declaration of the three statuses, so a status added
// there without wording here fails to compile rather than quietly writing no
// entry for a search activity the user really performed.
const ACTIVITY_BY_STATUS: Record<WorkLogStatus, WorkLogActivity> = {
  "app. sent": "Applied for job",
  screening: "Had phone screen",
  interview: "Had interview",
};

// The guard reads the declared list rather than asking the object whether it
// holds the key. A plain object answers yes to "constructor" and "toString"
// and hands back a function, and a status arrives as text the user typed.
export function activityFromStatus(status: string): WorkLogActivity | undefined {
  if (!isWorkLogStatus(status)) return undefined;
  return ACTIVITY_BY_STATUS[status as WorkLogStatus];
}

// Membership matters to the phase 13 migration, which checks each old entry's
// wording against these exact phrases before writing it — the form rejects
// any other.
export const WORK_LOG_ACTIVITIES = Object.values(ACTIVITY_BY_STATUS);

export function isWorkLogActivity(wording: string): boolean {
  return (WORK_LOG_ACTIVITIES as string[]).includes(wording);
}
