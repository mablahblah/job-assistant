// Adds hand-picked external job links to the pipeline: builds what the run
// shares, calls the runner, and reports what came back. Which steps run, and
// in what order, is the runner's to know rather than this script's.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPipelineDb } from "../lib/db/pipeline-db";
import { createCompanyService } from "../lib/services/company-service";
import { createAtsSlugService } from "../lib/services/ats-slug-service";
import { createJobService } from "../lib/services/job-service";
import { createPlaceService } from "../lib/services/place-service";
import { createSettingsService } from "../lib/services/settings-service";
import {
  runAddExternalJobs,
  type ExternalJobSubmission,
} from "../lib/orchestrators/add-external-jobs";
import { createResolutionBrowser } from "../lib/tools/resolution-browser";
import { createGeocoder } from "../lib/tools/geocoder";
import { createTraceService } from "../lib/services/trace-service";
import { schemaProbesFor } from "../lib/db/schema-check";
import { schemaHasDrifted } from "../lib/db/schema-drift";
import { flagValue } from "../lib/utils/cli-args";
import { addedJobsReport } from "../lib/utils/added-jobs-report";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const inPath = flagValue(argv, "in");
  if (!inPath) {
    console.error("Missing required flag: --in <path>");
    process.exitCode = 1;
    return;
  }
  // Read before the database is opened, so a bad path fails fast.
  const raw = readFileSync(resolve(inPath), "utf-8");
  // The file comes from disk with no type information, so one cast brings
  // it into the type system.
  const submissions = JSON.parse(raw) as ExternalJobSubmission[];

  const prisma = createPipelineDb();
  try {
    // Before anything else, and before the browser especially. A database
    // the code cannot read does not fail loudly: the trace service swallows
    // every write it cannot make, so a run would work through submissions
    // for minutes and end with no history of having done it. Stopping here
    // costs nothing; going on costs the whole run's record.
    if (await schemaHasDrifted(schemaProbesFor(prisma))) {
      process.exitCode = 1;
      return;
    }
    const settings = createSettingsService(prisma);
    const trace = createTraceService(prisma);
    const companies = createCompanyService(prisma);
    const atsSlugs = createAtsSlugService(prisma);
    const jobService = createJobService(prisma);
    const places = createPlaceService(prisma);
    const geocoder = createGeocoder();
    const runId = crypto.randomUUID();
    // Printed before anything else runs: the scoring skill reads this line
    // to file its own trace rows under the same run.
    console.log(`Run: ${runId}`);
    const collectedAt = new Date();
    const result = await runAddExternalJobs({
      submissions,
      settings,
      companies,
      atsSlugs,
      jobService,
      openBrowser: createResolutionBrowser,
      places,
      geocoder,
      collectedAt,
      runId,
      trace,
    });
    for (const line of addedJobsReport(result)) {
      console.log(line);
    }
    if (result.traceFailures > 0) {
      console.log(`Trace failures: ${result.traceFailures}`);
    }
    // Set rather than exited on, so the disconnect below still runs and
    // anything already written to stdout is flushed before the process ends.
    if (result.failure) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
