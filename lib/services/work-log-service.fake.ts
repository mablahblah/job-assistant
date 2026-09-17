// A stand-in WorkLogService for tests, holding its entries in an array rather
// than a table. Writing the same entry twice is allowed, so the array is
// appended to and never searched.
import type { WorkLogInput, WorkLogRecord, WorkLogService } from "./work-log-service";

export function fakeWorkLogService(
  entries: WorkLogRecord[] = [],
  overrides: Partial<WorkLogService> = {}
): WorkLogService {
  // Ids only need to be unique for the lifetime of one fake, so a simple
  // per-instance counter is enough — no need for a real id generator.
  let nextId = 0;
  function generateId(): string {
    nextId += 1;
    return `fake-work-log-${nextId}`;
  }

  // The real service hands back the row the database made, so the stand-in
  // has to supply an id and a creation date itself.
  async function write(entry: WorkLogInput): Promise<WorkLogRecord> {
    const record: WorkLogRecord = {
      ...entry,
      id: generateId(),
      created_at: new Date(),
    };
    entries.push(record);
    return record;
  }

  return {
    write,
    // A handler's test needs a failing write to check what the run reports,
    // and the real failure is a database refusal no array can produce. An
    // override is how a test supplies one.
    ...overrides,
  };
}
