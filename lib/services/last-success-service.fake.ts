// A stateful stand-in LastSuccessService for tests that run a collector or
// handler without a database. This one has to remember what happened between
// calls, so it keeps one time per (collector, search) pair in memory and
// replaces any earlier time for that pair on each record.
import type { LastSuccessService } from "./last-success-service";

export function fakeLastSuccessService(
  overrides: Partial<LastSuccessService> = {}
): LastSuccessService {
  // Map<collector, Map<search, Date>>
  const times = new Map<string, Map<string, Date>>();

  const find = async (collector: string, search: string): Promise<Date | null> => {
    const collectorTimes = times.get(collector);
    if (!collectorTimes) return null;
    return collectorTimes.get(search) ?? null;
  };

  const record = async (
    collector: string,
    search: string,
    succeededAt: Date
  ): Promise<void> => {
    if (!times.has(collector)) {
      times.set(collector, new Map());
    }
    times.get(collector)!.set(search, succeededAt);
  };

  return {
    find,
    record,
    ...overrides,
  };
}
