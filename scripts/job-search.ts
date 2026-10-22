// Starts a job search: builds what the whole run shares, calls the
// orchestrator, and reports what came back. Which steps run, and in what order,
// is the orchestrator's to know rather than this script's.
import { createPipelineDb } from "../lib/db/pipeline-db";
import { createCompanyService } from "../lib/services/company-service";
import { createAtsSlugService } from "../lib/services/ats-slug-service";
import { createLastSuccessService } from "../lib/services/last-success-service";
import { createJobService } from "../lib/services/job-service";
import { createPlaceService } from "../lib/services/place-service";
import { createSettingsService } from "../lib/services/settings-service";
import type { CollectionIssue } from "../lib/types/collection-issue";
import { runJobSearch } from "../lib/orchestrators/job-search";
import { createResolutionBrowser } from "../lib/tools/resolution-browser";
import { createGeocoder } from "../lib/tools/geocoder";
import { summaryFromTraceCounts } from "../lib/utils/run-summary";
import { createTraceService } from "../lib/services/trace-service";
import { COLLECTORS } from "../lib/collectors/registry";
import { schemaProbesFor } from "../lib/db/schema-check";
import { schemaHasDrifted } from "../lib/db/schema-drift";
import { issueLines } from "../lib/utils/print-issues";

// Prints what the shared builder laid out, so the wording of a reported
// problem lives in one place and only the printing is local.
function printIssues(label: string, issues: CollectionIssue[]): void {
  for (const line of issueLines(label, issues)) console.log(line);
}

// Reads `--limit N` off the command line. Omitted means collect everything.
// A limit of 0 reaches no source at all, which is how the test suite runs this
// command without touching a job site.
function limitFromArgs(argv: string[]): number | undefined {
  const flag = argv.indexOf("--limit");
  if (flag === -1) return undefined;
  const value = Number(argv[flag + 1]);
  if (!Number.isFinite(value)) {
    throw new Error("--limit needs a number, for example --limit 1");
  }
  return value;
}

async function main(): Promise<void> {
  const limit = limitFromArgs(process.argv.slice(2));
  const prisma = createPipelineDb();
  try {
    // Before anything else, and before the browser especially. A database the
    // code cannot read does not fail loudly: the trace service swallows every
    // write it cannot make, so a run would collect jobs for minutes and end
    // with no history of having done it. Stopping here costs nothing; going
    // on costs the whole run's record.
    if (await schemaHasDrifted(schemaProbesFor(prisma))) {
      process.exitCode = 1;
      return;
    }

    const settings = createSettingsService(prisma);
    const trace = createTraceService(prisma);
    // The one way anything reaches the Company table, so association attaches
    // each job to a company without opening a database of its own.
    const companies = createCompanyService(prisma);
    // The one way anything reaches the ATS slug table: which boards our
    // employers post on, and which of those we poll every run.
    const atsSlugs = createAtsSlugService(prisma);
    // The one way anything reaches the last-success table: when each collector
    // search last succeeded.
    const lastSuccesses = createLastSuccessService(prisma);
    // The one way anything reaches the Job table, so saving stays in one
    // place instead of leaking into collectors and parsers.
    const jobService = createJobService(prisma);
    // The one way anything reaches the Place table, so a place looked up once
    // is reused by every later run instead of being paid for again.
    const places = createPlaceService(prisma);
    // Holds its own pacing timer, so the one-lookup-a-second limit is kept by
    // the tool rather than by every caller remembering to wait.
    const geocoder = createGeocoder();
    // Names this job search so every trace event it produces can be grouped
    // and compared against other searches.
    const runId = crypto.randomUUID();
    // Printed before anything else runs: the scoring skill reads this line to
    // file its own trace rows under the same run.
    console.log(`Run: ${runId}`);
    // The date written into every job's collected_at, so one run's jobs share
    // a single timestamp even when collection takes minutes.
    const collectedAt = new Date();

    const report = await runJobSearch({
      settings,
      collectors: COLLECTORS,
      companies,
      atsSlugs,
      lastSuccesses,
      jobService,
      // createResolutionBrowser already takes an optional launcher and returns
      // a resolution browser session, which is exactly what openBrowser is
      // asked for, so it is handed over by name rather than wrapped.
      openBrowser: createResolutionBrowser,
      places,
      geocoder,
      collectedAt,
      runId,
      limit,
      trace,
    });

    printIssues("Errors", report.errors);
    printIssues("Warnings", report.warnings);

    if (report.failure) {
      console.log(`Run stopped at ${report.failure.at}: ${report.failure.reason}`);
      // Printed only here, on failure. A run that finishes cleanly has no
      // question to answer about which steps got that far, so the list would
      // only be noise beside the summary the user actually reads.
      console.log("Finished before it stopped:");
      for (const handler of report.handlers) {
        console.log(`  - ${handler.step}: ${handler.entries} entries`);
      }
    }

    if (report.traceFailures > 0) {
      console.log(`Trace failures: ${report.traceFailures}`);
    }

    // The report runJobSearch returns carries list lengths, not the
    // per-collector and per-reason numbers the summary needs — those exist
    // only as the trace rows each step wrote while it ran. Reading them back
    // from the database here also means a run that stopped early still gets a
    // summary of whatever did finish, because those rows are already written
    // by the time runJobSearch returns.
    const counts = await trace.countsForRun(runId);
    const collectorNames = COLLECTORS.map((collector) => collector.name);
    // Where the run stopped, so the step it died inside says so in its heading
    // rather than printing a partial block that reads as a complete one.
    const stoppedAt = report.failure?.at ?? null;
    for (const line of summaryFromTraceCounts(counts, collectorNames, stoppedAt)) {
      console.log(line);
    }

    // Set rather than exited on, so the disconnect below still runs and
    // anything already written to stdout is flushed before the process ends.
    if (report.failure) {
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
