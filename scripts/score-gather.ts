// Scoring cannot run inside the pipeline: deciding whether a job or company
// is worth pursuing takes an agent's judgment, not a deterministic step. This
// command gathers whatever needs that judgment and writes it out as JSON for
// an agent to read; a second command saves the answers it comes back with.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPipelineDb } from "../lib/db/pipeline-db";
import { createCompanyService } from "../lib/services/company-service";
import { createJobService } from "../lib/services/job-service";
import { createSettingsService } from "../lib/services/settings-service";
import { createTraceService } from "../lib/services/trace-service";
import type { CollectionIssue } from "../lib/types/collection-issue";
import { runScoringGather } from "../lib/orchestrators/scoring";
import { schemaProbesFor } from "../lib/db/schema-check";
import { schemaHasDrifted } from "../lib/db/schema-drift";
import { flagValue } from "../lib/utils/cli-args";
import { issueLines } from "../lib/utils/print-issues";

// Prints what the shared builder laid out, so the wording of a reported
// problem lives in one place and only the printing is local.
function printIssues(label: string, issues: CollectionIssue[]): void {
  for (const line of issueLines(label, issues)) console.log(line);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outPath = flagValue(argv, "out");

  // Nothing here is worth doing if there is nowhere to write the result, and
  // failing before the database is even opened keeps this check free of side
  // effects to reason about.
  if (!outPath) {
    console.error("Missing required flag: --out <path>");
    process.exitCode = 1;
    return;
  }

  // With no run id supplied, this run mints its own so its trace events can
  // still be grouped and compared, the same as any other run. The handed
  // value keeps its own name so the stranger check below fires only on it.
  const handedRunId = flagValue(argv, "run-id");
  const runId = handedRunId ?? crypto.randomUUID();

  const prisma = createPipelineDb();
  try {
    // Same reasoning as job-search.ts: a database that cannot be read should
    // stop the run here, loudly, rather than fail silently partway through.
    if (await schemaHasDrifted(schemaProbesFor(prisma))) {
      process.exitCode = 1;
      return;
    }

    const settings = createSettingsService(prisma);
    const trace = createTraceService(prisma);
    const companies = createCompanyService(prisma);
    const jobService = createJobService(prisma);

    // Only a handed identifier can warn: a minted one never matches anything
    // and nobody mistyped it. A stale or mistyped identifier would otherwise
    // silently file this scoring under a run that never happened.
    if (handedRunId !== undefined) {
      const counts = await trace.countsForRun(handedRunId);
      if (counts.length === 0) {
        console.log(
          `Warning: run identifier "${handedRunId}" matches no trace rows from an earlier run.`
        );
      }
    }

    // Minted once so every age computed during this run is measured against
    // the same instant, rather than drifting as the gather takes time.
    const referenceInstant = new Date();

    const result = await runScoringGather({
      settings,
      companies,
      jobService,
      trace,
      runId,
      referenceInstant,
    });

    const destination = resolve(outPath);
    const work = {
      runId,
      jobs: result.jobs,
      companies: result.companies,
      warnings: result.warnings,
      failure: result.failure,
    };
    writeFileSync(destination, JSON.stringify(work, null, 2));

    console.log(
      `Gathered ${result.jobs.length} job(s) and ${result.companies.length} compan${
        result.companies.length === 1 ? "y" : "ies"
      } to score. Wrote ${destination}.`
    );

    printIssues("Warnings", result.warnings);

    if (result.failure) {
      console.log(`Run stopped at ${result.failure.at}: ${result.failure.reason}`);
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
