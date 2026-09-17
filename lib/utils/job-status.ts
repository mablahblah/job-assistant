// The statuses that mean the user has applied to a job and has not been
// rejected. A row in one of these statuses is frozen except for its status:
// a later collection run must not overwrite it, and the save step refuses to
// delete it even where dedupe marked it a duplicate.
//
// Save, the Web UI job lists and update-job all read this one list, so the
// three cannot disagree about what the user has applied to.
export const ACTIVE_STATUSES = [
  "app. sent",
  "screening",
  "interview",
  "test",
  "offer",
] as const;

// True when a status is one of the active ones. A caller holding a status
// that might be absent guardrails it before asking.
export function isActiveStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

// The twelve statuses the database accepts. Declared once, and nowhere else,
// so a typo cannot put a job into a state no query reads.
export const VALID_STATUSES = [
  "backlog",
  "expired",
  "too far",
  "won't apply",
  "unresolvable",
  "unparseable",
  "rejected",
  "app. sent",
  "screening",
  "interview",
  "test",
  "offer",
] as const;

// True when a status is one the database accepts.
export function isValidStatus(status: string): boolean {
  return (VALID_STATUSES as readonly string[]).includes(status);
}

// The statuses the Texas Workforce Commission counts as a job search
// activity. Deliberately not the active list above: Texas counts activities
// rather than job states, so test and offer are active without being
// activities. The two lists sit in one file because typed apart they would
// drift by a character and a legal record would quietly stop being written.
export const WORK_LOG_STATUSES = [
  "app. sent",
  "screening",
  "interview",
] as const;

// True when a status writes a work log entry — a legal filing that cannot be
// regenerated once the week it belongs to has passed.
export function isWorkLogStatus(status: string): boolean {
  return (WORK_LOG_STATUSES as readonly string[]).includes(status);
}
