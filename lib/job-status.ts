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
// that might be absent guards it before asking.
export function isActiveStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}
