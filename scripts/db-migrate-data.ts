import "dotenv/config";
import { createClient, type Client } from "@libsql/client";
import { createPipelineDb } from "../lib/db/pipeline-db";
import { modelsFailingSchemaCheck, schemaProbesFor } from "../lib/db/schema-check";
import { ACTIVE_STATUSES } from "../lib/utils/job-status";

// Every count query below aliases its aggregate as "count" so this helper
// never has to guess a column name back out of the SQL it was given.
async function scalarCount(client: Client, sql: string, args: string[] = []): Promise<number> {
  const result = await client.execute({ sql, args });
  const value = result.rows[0]?.["count"];
  return Number(value ?? 0);
}

async function main(): Promise<void> {
  // The source is the old, pre-rebuild database — read raw with libsql and
  // never written to. This script imports nothing from legacy/.
  const sourceUrl = process.env["DATABASE_URL"];
  if (!sourceUrl) {
    console.error(
      "Refusing to run: DATABASE_URL is not set — it must point at the old database to migrate from."
    );
    process.exitCode = 1;
    return;
  }

  const source = createClient({ url: sourceUrl });
  const prisma = createPipelineDb();

  try {
    // Guard: the target's schema has to match what this code expects
    // before any of its tables are trusted enough to count rows in.
    const drifted = await modelsFailingSchemaCheck(schemaProbesFor(prisma));
    if (drifted.length > 0) {
      console.log("The database does not match the schema this code expects.");
      console.log(`Tables that could not be read: ${drifted.join(", ")}`);
      console.log("Migrate it with: npm run db:migrate");
      process.exitCode = 1;
      return;
    }

    // Guard: this migration is meant to run exactly once. Finding a work
    // log entry already in the target is proof a run already succeeded.
    if ((await prisma.workLogEntry.count()) > 0) {
      console.error(
        "Refusing to run: the target already has work log entries — this migration has already run."
      );
      process.exitCode = 1;
      return;
    }

    // Guard: the target has to start empty. A partly filled target makes
    // it impossible to tell rows this run added from rows already there.
    if ((await prisma.job.count()) > 0) {
      console.error("Refusing to run: the target already has jobs — it must start empty.");
      process.exitCode = 1;
      return;
    }

    if ((await prisma.company.count()) > 0) {
      console.error("Refusing to run: the target already has companies — it must start empty.");
      process.exitCode = 1;
      return;
    }

    // Migration steps land here, across the next three tasks, in this order:
    //   1. Employers (companies) — copied first, because a job points at one.
    //   2. Jobs — copied second, because a work log entry names one.
    //   3. Work log entries — copied last.
    // No trace service is built here and nothing is written to the Trace
    // table: a one-time data migration is not a job search, so it leaves
    // no trace of being one.

    // Verification counts both databases live, at this exact moment,
    // instead of trusting a running tally kept during migration — a live
    // recount is the only way to catch rows silently dropped or duplicated.
    const activeStatuses = [...ACTIVE_STATUSES];
    const placeholders = activeStatuses.map(() => "?").join(", ");

    let allMatch = true;
    const compare = (label: string, sourceCount: number, targetCount: number): void => {
      console.log(`${label}: source=${sourceCount} target=${targetCount}`);
      if (sourceCount !== targetCount) {
        console.log(`Mismatch: ${label}`);
        allMatch = false;
      }
    };

    const sourceEmployerCount = await scalarCount(
      source,
      `SELECT count(DISTINCT companyId) AS count FROM Job WHERE status IN (${placeholders})`,
      activeStatuses
    );
    compare("employers of active jobs", sourceEmployerCount, await prisma.company.count());

    const sourceActiveJobCount = await scalarCount(
      source,
      `SELECT count(*) AS count FROM Job WHERE status IN (${placeholders})`,
      activeStatuses
    );
    compare("active jobs", sourceActiveJobCount, await prisma.job.count());

    const sourceWorkLogCount = await scalarCount(
      source,
      "SELECT count(*) AS count FROM WorkSearchEntry"
    );
    compare("work log entries", sourceWorkLogCount, await prisma.workLogEntry.count());

    if (allMatch) {
      console.log("Verification passed: every count matches between source and target.");
    } else {
      process.exitCode = 1;
    }
  } finally {
    source.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
