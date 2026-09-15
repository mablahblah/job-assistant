// Catches the one failure that destroys a run silently: a database whose
// tables no longer match the code that reads them. It happened for real — a
// column added to the schema was never pushed to the live database, so every
// trace write of that run failed, was swallowed by the trace service, and a
// whole run's history was lost without a word.
//
// The check is a read of each table rather than a comparison of column lists.
// Prisma names every column it knows about in the SELECT it builds, so a read
// that succeeds is proof the database holds them all, and a read that fails
// says so in the database's own words. Nothing here has to be kept in step
// with the schema by hand, which is what went wrong in the first place.
import type { createPipelineDb } from "./pipeline-db";

export interface SchemaProbe {
  name: string;
  read: () => Promise<unknown>;
}

type PipelineDb = ReturnType<typeof createPipelineDb>;

// Every model this check covers. Named here rather than only inside the
// probes below so a test can read it against the models in schema.prisma: a
// hand-kept list going stale is the exact failure this whole file exists to
// catch, and this file must not be the one that goes stale.
export const CHECKED_MODELS = [
  "Job",
  "Company",
  "AtsSlug",
  "Place",
  "Setting",
  "Trace",
] as const;

// One probe per model. A findFirst on an empty table still asks for every
// column, so this catches a mismatch on a database holding no rows at all.
export function schemaProbesFor(db: PipelineDb): SchemaProbe[] {
  return [
    { name: "Job", read: () => db.job.findFirst() },
    { name: "Company", read: () => db.company.findFirst() },
    { name: "AtsSlug", read: () => db.atsSlug.findFirst() },
    { name: "Place", read: () => db.place.findFirst() },
    { name: "Setting", read: () => db.setting.findFirst() },
    { name: "Trace", read: () => db.trace.findFirst() },
  ];
}

// Every probe is run, including the ones after a failure, so one trip round
// the rebuild loop fixes every table rather than one per table.
export async function modelsFailingSchemaCheck(probes: SchemaProbe[]): Promise<string[]> {
  const failing: string[] = [];

  for (const probe of probes) {
    try {
      await probe.read();
    } catch {
      failing.push(probe.name);
    }
  }

  return failing;
}
