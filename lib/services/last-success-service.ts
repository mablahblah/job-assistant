// Owns every read and write of the table that holds when each of a
// collector's searches last worked, one time per search (for example a remote
// search and a local search). Collectors only read it, and a step after the
// post-collection save writes it, so a time moves only once that search's jobs
// are stored.
import type { createPipelineDb } from "../db/pipeline-db";

export interface LastSuccessService {
  // Returns when this search of this collector last worked, or null if it never has.
  find(collector: string, search: string): Promise<Date | null>;
  // Sets when this search of this collector last worked, replacing any earlier time.
  record(collector: string, search: string, succeededAt: Date): Promise<void>;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

export function createLastSuccessService(db: PipelineDb): LastSuccessService {
  return {
    async find(collector, search) {
      const row = await db.lastSuccess.findUnique({
        where: { collector_search: { collector, search } },
        select: { succeeded_at: true },
      });
      return row?.succeeded_at ?? null;
    },

    async record(collector, search, succeededAt) {
      await db.lastSuccess.upsert({
        where: { collector_search: { collector, search } },
        create: { collector, search, succeeded_at: succeededAt },
        update: { succeeded_at: succeededAt },
      });
    },
  };
}
