import "dotenv/config";
import { createClient, type Client } from "@libsql/client";
import { createPipelineDb } from "../lib/db/pipeline-db";
import { modelsFailingSchemaCheck, schemaProbesFor } from "../lib/db/schema-check";
import { createCompanyService, type CompanyService } from "../lib/services/company-service";
import { createWorkLogService, type WorkLogService } from "../lib/services/work-log-service";
import { companyMatchKey } from "../lib/utils/company-match-key";
import { normalizeCompanyName } from "../lib/utils/company-name";
import { ACTIVE_STATUSES } from "../lib/utils/job-status";
import { isWorkLogActivity } from "../lib/utils/work-log-activity";

// Every count query below aliases its aggregate as "count" so this helper
// never has to guess a column name back out of the SQL it was given.
async function scalarCount(client: Client, sql: string, args: string[] = []): Promise<number> {
  const result = await client.execute({ sql, args });
  const value = result.rows[0]?.["count"];
  return Number(value ?? 0);
}

interface OldEmployer {
  id: string;
  name: string;
  cleanedName: string;
  matchKey: string;
  atsSlug: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  enrichedAt: string | null;
  updatedAt: string;
}

async function readMigratingEmployers(source: Client): Promise<OldEmployer[]> {
  const activeStatuses = [...ACTIVE_STATUSES];
  const placeholders = activeStatuses.map(() => "?").join(", ");

  const result = await source.execute({
    sql:
      "SELECT DISTINCT Company.id AS id, Company.name AS name, Company.atsSlug AS atsSlug, " +
      "Company.address AS address, Company.phone AS phone, Company.website AS website, " +
      "Company.enrichedAt AS enrichedAt, Company.updatedAt AS updatedAt " +
      "FROM Company JOIN Job ON Job.companyId = Company.id " +
      `WHERE Job.status IN (${placeholders}) ORDER BY Company.name`,
    args: activeStatuses,
  });

  const employers: OldEmployer[] = result.rows.map((raw) => {
    const row = raw as unknown as Record<string, unknown>;
    const name = String(row["name"]);
    const cleanedName = normalizeCompanyName(name);
    return {
      id: String(row["id"]),
      name,
      cleanedName,
      // Computed with the same shared code the target's create() uses, so a
      // collision found here is guaranteed to also be a collision there.
      matchKey: companyMatchKey(cleanedName),
      atsSlug: row["atsSlug"] === null ? null : String(row["atsSlug"]),
      address: row["address"] === null ? null : String(row["address"]),
      phone: row["phone"] === null ? null : String(row["phone"]),
      website: row["website"] === null ? null : String(row["website"]),
      enrichedAt: row["enrichedAt"] === null ? null : String(row["enrichedAt"]),
      updatedAt: String(row["updatedAt"]),
    };
  });

  // Both pre-checks run here, before any migrator (the work log migrator
  // included) has written a single row. Without this, a collision would only
  // surface later as a unique-column failure on the target, after some rows
  // were already committed, leaving a half-written database to clean up.

  // Two employers whose cleaned names fold to the same match key would
  // collide on the target's unique match_key column.
  const byMatchKey = new Map<string, OldEmployer>();
  for (const employer of employers) {
    const existing = byMatchKey.get(employer.matchKey);
    if (existing) {
      throw new Error(
        `Employer match-key collision: "${existing.cleanedName}" and ` +
          `"${employer.cleanedName}" both fold to match key "${employer.matchKey}"`
      );
    }
    byMatchKey.set(employer.matchKey, employer);
  }

  // Two employers sharing a non-null board slug would collide the same way.
  // Employers with no slug are unrelated and never compared.
  const byAtsSlug = new Map<string, OldEmployer>();
  for (const employer of employers) {
    if (employer.atsSlug === null) continue;
    const existing = byAtsSlug.get(employer.atsSlug);
    if (existing) {
      throw new Error(
        `Employer board-slug collision: "${existing.cleanedName}" and ` +
          `"${employer.cleanedName}" both carry the slug "${employer.atsSlug}"`
      );
    }
    byAtsSlug.set(employer.atsSlug, employer);
  }

  return employers;
}

async function migrateEmployers(
  employers: OldEmployer[],
  companies: CompanyService
): Promise<Map<string, string>> {
  const oldToNewCompanyId = new Map<string, string>();

  for (const employer of employers) {
    const { company, created } = await companies.create({ name: employer.cleanedName });
    // The target is guarded empty and the pre-check already ruled out
    // in-batch collisions, so create() finding an existing row here means
    // something upstream is wrong — fail loudly instead of silently reusing
    // a company that is not this employer's migration.
    if (!created) {
      throw new Error(
        `Expected to create a new company for "${employer.cleanedName}" but one already existed`
      );
    }

    if (employer.address !== null || employer.phone !== null || employer.website !== null) {
      // Dated to the old enrichment, or failing that the old row's last
      // write, rather than today — the migration never ran a contact-detail
      // search, so it must not look like it just did.
      const at =
        employer.enrichedAt !== null ? new Date(employer.enrichedAt) : new Date(employer.updatedAt);
      await companies.saveEnrichment(
        company.id,
        {
          address: employer.address ?? undefined,
          phone: employer.phone ?? undefined,
          website: employer.website ?? undefined,
        },
        [],
        at
      );
    }
    // No scores are written here — create() writes none, so a migrated
    // company starts with every score column empty for a fresh judgement.

    oldToNewCompanyId.set(employer.id, company.id);
  }

  console.log(`Employers migrated: ${employers.length}`);
  return oldToNewCompanyId;
}

async function migrateWorkLogEntries(source: Client, workLog: WorkLogService): Promise<void> {
  const result = await source.execute(`
    SELECT
      WorkSearchEntry.jobId AS job_id,
      WorkSearchEntry.date AS date,
      WorkSearchEntry.activityType AS activity,
      Job.title AS job_title,
      Company.name AS company_name
    FROM WorkSearchEntry
    JOIN Job ON Job.id = WorkSearchEntry.jobId
    JOIN Company ON Company.id = Job.companyId
    ORDER BY WorkSearchEntry.date
  `);

  let migrated = 0;

  for (const raw of result.rows) {
    const row = raw as unknown as Record<string, unknown>;
    const jobId = String(row["job_id"]);
    const activity = String(row["activity"]);

    // The Texas work log form only accepts a fixed set of activity wordings.
    // An old entry with wording outside that set would produce a filing the
    // form itself would reject, so the whole run stops rather than write it.
    if (!isWorkLogActivity(activity)) {
      throw new Error(`Unknown work log activity "${activity}" on entry for job ${jobId}`);
    }

    await workLog.write({
      job_id: jobId,
      company_name: String(row["company_name"]),
      job_title: String(row["job_title"]),
      activity,
      // created_at carries the activity's own date, not the old row's
      // written-date: the two differ on 21 of 70 real filings, and the
      // weekly grouping reads created_at.
      created_at: new Date(String(row["date"])),
    });

    migrated += 1;
  }

  console.log(`Work log entries migrated: ${migrated}`);
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

    // Migration steps run in this order — employers, then jobs, then work
    // log entries — because a job points at its employer and an entry names
    // its job. The employer and job migrators land in the next two tasks.
    // No trace service is built here and nothing is written to the Trace
    // table: a one-time data migration is not a job search, so it leaves
    // no trace of being one.
    const employers = await readMigratingEmployers(source);
    const companies = createCompanyService(prisma);
    const oldToNewCompanyId = await migrateEmployers(employers, companies);
    void oldToNewCompanyId; // the job migrator, next task, is its consumer
    const workLog = createWorkLogService(prisma);
    await migrateWorkLogEntries(source, workLog);

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
