// Changes the status of one or more jobs, by hand. This is the first command
// in the app a job search never starts: everything else runs inside a run, and
// this runs because the user says a job moved.
//
// A qualifying status writes a work log entry — a Texas Workforce Commission
// filing that cannot be regenerated once its week has passed. That is why a
// submission holding one bad status is refused whole rather than applied in
// part: half a batch landing is worse than none, because the user would then
// have to work out which half.
//
// There is no page in this phase, so the report printed at the end is the only
// place the user learns that a legal record exists.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPipelineDb } from "../lib/db/pipeline-db";
import { modelsFailingSchemaCheck, schemaProbesFor } from "../lib/db/schema-check";
import { createSettingsService } from "../lib/services/settings-service";
import { createJobService } from "../lib/services/job-service";
import { createCompanyService } from "../lib/services/company-service";
import { createWorkLogService } from "../lib/services/work-log-service";
import { createCompanySearch } from "../lib/tools/company-search";
import { runStatusChange } from "../lib/orchestrators/status-change";
import { statusChangeReport } from "../lib/utils/status-change-report";
import { isValidStatus } from "../lib/utils/job-status";
import type { StatusChange } from "../lib/handlers/status-change";

// Reads a `--name value` pair off the command line. Undefined when the flag
// is absent, so the caller decides what that means.
function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return argv[index + 1];
}

// An entry as it arrives off disk, before it has earned the right to be a
// StatusChange.
interface RawEntry {
  job_id?: unknown;
  status?: unknown;
  company_name?: unknown;
}

async function main(): Promise<void> {
  const inPath = flagValue(process.argv.slice(2), "in");
  if (inPath === undefined) {
    console.error("Missing required flag: --in <path>");
    process.exitCode = 1;
    return;
  }

  // The submission comes from disk rather than from code, so reading it and
  // parsing it are one untrusted step and either failure reads the same way.
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(inPath), "utf-8"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  if (!Array.isArray(parsed)) {
    console.error("Refused: the submission file must hold a JSON array.");
    process.exitCode = 1;
    return;
  }

  // Each message names the entry's position, because a submission is written
  // by a skill and a rejected one has to be findable without counting.
  const changes: StatusChange[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const entry: unknown = parsed[index];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      console.error(`Refused: entry ${index} is not an object.`);
      process.exitCode = 1;
      return;
    }

    const { job_id, status, company_name } = entry as RawEntry;

    if (typeof job_id !== "string" || job_id === "") {
      console.error(`Refused: entry ${index} holds no job id.`);
      process.exitCode = 1;
      return;
    }
    if (typeof status !== "string") {
      console.error(`Refused: entry ${index} holds no status.`);
      process.exitCode = 1;
      return;
    }
    if (company_name !== undefined && typeof company_name !== "string") {
      console.error(`Refused: entry ${index} holds an employer name that is not text.`);
      process.exitCode = 1;
      return;
    }

    changes.push({
      job_id,
      status,
      ...(company_name === undefined ? {} : { company_name }),
    });
  }

  // The refusal names the status itself. A typo is the only thing this check
  // ever catches, and the user needs to see what they typed.
  for (const change of changes) {
    if (!isValidStatus(change.status)) {
      console.error(
        `Refused: "${change.status}" is not one of the twelve statuses the database accepts.`
      );
      process.exitCode = 1;
      return;
    }
  }

  const prisma = createPipelineDb();
  try {
    // The same check every other command runs, before anything is written. It
    // reads each table whole and reports only the table's name, which is why
    // the message names tables rather than columns.
    const drifted = await modelsFailingSchemaCheck(schemaProbesFor(prisma));
    if (drifted.length > 0) {
      console.log("The database does not match the schema this code expects.");
      console.log(`Tables that could not be read: ${drifted.join(", ")}`);
      console.log("Migrate it with: npm run db:migrate");
      process.exitCode = 1;
      return;
    }

    const settings = createSettingsService(prisma);
    const jobs = createJobService(prisma);
    const companies = createCompanyService(prisma);
    const workLog = createWorkLogService(prisma);
    const search = createCompanySearch();
    const priorityList = await settings.getSourcePriorityList();

    // Awaited in full. The old code started its search and never waited, and
    // Node kills work still in flight when a process exits — which is a live
    // cause of the employer lookup running sometimes and not others.
    const result = await runStatusChange(changes, {
      jobs,
      companies,
      workLog,
      search,
      priorityList,
      now: new Date(),
    });

    for (const line of statusChangeReport({
      changes: result.changes,
      companies: result.companies,
    })) {
      console.log(line);
    }

    if (result.warnings.length === 0) {
      console.log("Warnings: none");
    } else {
      console.log("Warnings:");
      for (const warning of result.warnings) {
        console.log(`  ${warning}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
