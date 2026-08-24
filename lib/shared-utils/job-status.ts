// The ten statuses a job can hold. Source: the Job.status comment in
// prisma/schema.prisma. Every status sits in exactly one base group below,
// and the combined sets derive from those groups so nothing is listed twice.

// The queue — a collected job waiting to be judged.
export const BACKLOG_STATUS = "backlog";

// In the application pipeline. These records are never overwritten in place.
export const ACTIVE_STATUSES = ["app. sent", "screening", "interview", "test", "offer"];

// Terminal — out of the running, but the record is kept.
export const DISQUALIFIED_STATUSES = ["too far", "expired", "won't apply", "rejected"];

// Safe to overwrite in place: the queue plus everything terminal.
export const REPLACEABLE_STATUSES = [BACKLOG_STATUS, ...DISQUALIFIED_STATUSES];

// Every valid status.
export const ALL_STATUSES = [BACKLOG_STATUS, ...ACTIVE_STATUSES, ...DISQUALIFIED_STATUSES];

// Sets backing the predicates below so membership checks stay constant-time.
const REPLACEABLE_SET = new Set(REPLACEABLE_STATUSES);
const ALL_SET = new Set(ALL_STATUSES);

// True when the job's record may be overwritten in place.
export function isReplaceableStatus(status: string): boolean {
  return REPLACEABLE_SET.has(status);
}

// True when the string is one of the ten known statuses.
export function isValidStatus(status: string): boolean {
  return ALL_SET.has(status);
}
